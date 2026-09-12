// Admin: import site tag events for one enterprise account by hand.
//
// The account's tracking tag normally writes measured events into
// public.pixel_events. This endpoint accepts the same shape as a small batch
// upload so an admin can load a file of their own events, then reports how many
// of those devices actually line up with scored rows — which is exactly what
// the Enrichment confidence and tag-impact estimates depend on.
//
// Nothing is invented: the coverage figures come from counting the rows that
// were just written against the account's own records.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { z } from "https://esm.sh/zod@3.23.8";
import { AuthzError, requireOrgMember } from "../_shared/org.ts";
import { controlNumber } from "../_shared/control.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const RowSchema = z.object({
  external_user_id: z.string().trim().min(1).max(256),
  event_name: z.string().trim().min(1).max(120).optional(),
  kpi_metric: z.string().trim().min(1).max(120),
  kpi_value: z.union([z.number(), z.string()]).optional(),
  occurred_at: z.string().trim().min(4).max(64).optional(),
  page_url: z.string().trim().max(2048).optional(),
});

const BodySchema = z.object({
  organization_id: z.string().uuid(),
  tag_id: z.string().trim().min(1).max(64).default("manual-upload"),
  tag_name: z.string().trim().min(1).max(120).default("Manual upload"),
  rows: z.array(RowSchema).min(1).max(5000),
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const admin = createClient(SUPABASE_URL, SERVICE_KEY);

  try {
    const parsed = BodySchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      return json({ error: parsed.error.flatten().fieldErrors }, 400);
    }
    const { organization_id: organizationId, tag_id, tag_name, rows } = parsed.data;

    await requireOrgMember(req, admin, organizationId, true);

    // Keep a tag record so the events belong to something the account can see.
    const { data: existingTag } = await admin
      .from("pixel_tags")
      .select("id")
      .eq("organization_id", organizationId)
      .eq("tag_id", tag_id)
      .maybeSingle();
    if (!existingTag) {
      const { error: tagErr } = await admin.from("pixel_tags").insert({
        organization_id: organizationId,
        tag_id,
        name: tag_name,
        active: true,
      });
      if (tagErr) throw new Error(tagErr.message);
    }

    const skipped: string[] = [];
    const payload = rows.flatMap((r, index) => {
      const rawValue = r.kpi_value;
      const value = rawValue === undefined || rawValue === "" ? NaN : Number(rawValue);
      if (!Number.isFinite(value)) {
        skipped.push(`row ${index + 1}: kpi_value is not a number`);
        return [];
      }
      let occurred = new Date().toISOString();
      if (r.occurred_at) {
        const when = new Date(r.occurred_at);
        if (Number.isNaN(when.getTime())) {
          skipped.push(`row ${index + 1}: occurred_at is not a date`);
          return [];
        }
        occurred = when.toISOString();
      }
      return [{
        organization_id: organizationId,
        tag_id,
        event_name: r.event_name ?? "manual_import",
        external_user_id: r.external_user_id,
        kpi_metric: r.kpi_metric,
        kpi_value: value,
        page_url: r.page_url ?? null,
        occurred_at: occurred,
        props: { imported: true },
      }];
    });

    if (!payload.length) {
      return json({ inserted: 0, skipped, error: "No usable rows in this upload." }, 400);
    }

    let inserted = 0;
    for (let i = 0; i < payload.length; i += 500) {
      const chunk = payload.slice(i, i + 500);
      const { error: insErr } = await admin.from("pixel_events").insert(chunk);
      if (insErr) throw new Error(insErr.message);
      inserted += chunk.length;
    }

    // ---- coverage: how many of these devices carry scores already -----------
    const devices = [...new Set(payload.map((p) => p.external_user_id))];
    const metrics = new Map<string, { events: number; devices: Set<string>; total: number }>();
    for (const p of payload) {
      const bucket = metrics.get(p.kpi_metric) ?? { events: 0, devices: new Set<string>(), total: 0 };
      bucket.events += 1;
      bucket.total += Number(p.kpi_value);
      bucket.devices.add(p.external_user_id);
      metrics.set(p.kpi_metric, bucket);
    }

    const matchedDevices = new Set<string>();
    let scoredDevices = 0;
    for (let i = 0; i < devices.length; i += 400) {
      const slice = devices.slice(i, i + 400);
      const { data: recs, error: recErr } = await admin
        .from("enterprise_records")
        .select("external_user_id, analysis_status")
        .eq("organization_id", organizationId)
        .in("external_user_id", slice);
      if (recErr) throw new Error(recErr.message);
      for (const rec of recs ?? []) {
        const id = String(rec.external_user_id ?? "");
        if (!id) continue;
        matchedDevices.add(id);
        if (rec.analysis_status === "scored") scoredDevices += 1;
      }
    }

    const minRows = Math.round(
      await controlNumber(admin, "predict.min_kpi_rows", 24, { min: 8, max: 500 }),
    );

    return json({
      inserted,
      skipped,
      tag_id,
      devices: devices.length,
      matched_devices: matchedDevices.size,
      scored_devices: scoredDevices,
      min_rows_for_impact: minRows,
      impact_ready: scoredDevices >= minRows,
      metrics: [...metrics.entries()]
        .map(([kpi_metric, b]) => ({
          kpi_metric,
          events: b.events,
          devices: b.devices.size,
          avg_value: b.events ? Number((b.total / b.events).toFixed(3)) : 0,
        }))
        .sort((a, b) => b.devices - a.devices),
    });
  } catch (error) {
    const status = error instanceof AuthzError ? error.status : 500;
    return json({ error: error instanceof Error ? error.message : "Import failed" }, status);
  }
});
