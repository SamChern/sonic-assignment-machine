// Step 6 — Activation file export.
//
// Turns an export-eligible sonic cohort into an Intuizi Activation file: one
// uppercase 32-hex EID per row, gzipped, written to S3 under
//   outbound/activation/dt=<YYYY-MM-DD>/cohort=<slug>/part-000.csv.gz
//
// Guardrails:
//   * admin (or service-role tick) only
//   * refuses cohorts that are not export_eligible (min 1,000 members)
//   * subject keys and EIDs never appear in the HTTP response or in logs —
//     only counts, byte sizes and the object key are returned
//
// Each attempt writes a row to public.sonic_cohort_exports so the admin UI can
// show export history, including failures.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { AuthzError, requireAdmin } from "../_shared/admin.ts";
import { putObject } from "../_shared/s3.ts";
import {
  activationCsv,
  activationDate,
  activationObjectKey,
  activationRefusal,
  buildActivationFile,
  MIN_ACTIVATION_MEMBERS,
} from "../_shared/activationFile.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const PAGE = 1000;
const MIN_MEMBERS = MIN_ACTIVATION_MEMBERS;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function gzip(text: string): Promise<Uint8Array> {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream("gzip"));
  const buf = await new Response(stream).arrayBuffer();
  return new Uint8Array(buf);
}

/**
 * Which Intuizi activations delivered these subjects? Read from the scoring
 * queue, which carries the activation each identifier arrived under. Subject
 * keys stay inside this function — only activation ids come back.
 */
async function resolveActivationIds(
  admin: ReturnType<typeof createClient>,
  subjectKeys: string[],
): Promise<string[]> {
  const found = new Set<string>();
  const sample = subjectKeys.slice(0, 5000);
  for (let i = 0; i < sample.length; i += PAGE) {
    const slice = sample.slice(i, i + PAGE);
    const { data, error } = await admin
      .from("intuizi_score_queue")
      .select("activation_id")
      .in("identifier", slice)
      .not("activation_id", "is", null);
    if (error) {
      console.error("activation grant resolution failed", error.message);
      break;
    }
    for (const row of (data ?? []) as { activation_id: string | null }[]) {
      if (row.activation_id) found.add(row.activation_id);
    }
  }
  return Array.from(found);
}


Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const startedAt = Date.now();
  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  let exportRowId: string | null = null;

  try {
    let actorId: string | null = null;
    try {
      const caller = await requireAdmin(req, admin);
      actorId = caller.userId;
    } catch (e) {
      if (e instanceof AuthzError) return json({ success: false, error: e.message }, e.status);
      throw e;
    }

    const body = await req.json().catch(() => ({})) as {
      cohort_slug?: string;
      organization_id?: string | null;
      activation_id?: string | null;
      dt?: string;
      dry_run?: boolean;
    };

    if (!body.cohort_slug) {
      return json({ success: false, error: "cohort_slug is required" }, 400);
    }
    const dt = activationDate(body.dt);

    const { data: cohort, error: cohortErr } = await admin
      .from("sonic_cohorts")
      .select("id, slug, name, member_count, export_eligible")
      .eq("slug", body.cohort_slug)
      .maybeSingle();
    if (cohortErr) throw new Error(`cohort read failed: ${cohortErr.message}`);
    if (!cohort) return json({ success: false, error: "cohort not found" }, 404);

    const c = cohort as {
      id: string;
      slug: string;
      name: string;
      member_count: number;
      export_eligible: boolean;
    };

    const refusal = activationRefusal(c.member_count, c.export_eligible, c.slug);
    if (refusal) {
      return json({
        success: false,
        error: refusal,
        member_count: c.member_count,
        min_members: MIN_MEMBERS,
      }, 409);
    }

    // ---- collect + normalize EIDs (never logged, never returned) ------------
    // Members flagged `holdout` (Step 11c) are withheld from the file so pixel
    // events split into exposed vs. holdout and activation-lift can report lift.
    const members: { subject_key: string; holdout: boolean }[] = [];
    for (let offset = 0; ; offset += PAGE) {
      const { data, error } = await admin
        .from("sonic_cohort_members")
        .select("subject_key, holdout")
        .eq("cohort_id", c.id)
        .order("subject_key", { ascending: true })
        .range(offset, offset + PAGE - 1);
      if (error) throw new Error(`member read failed: ${error.message}`);
      const rows = (data ?? []) as { subject_key: string; holdout: boolean }[];
      members.push(...rows);
      if (rows.length < PAGE) break;
    }

    const file = await buildActivationFile(members);
    const { eids, subjectKeys, heldOut, skipped } = file;

    if (eids.length < MIN_MEMBERS) {
      return json({
        success: false,
        error:
          `only ${eids.length} usable identifiers after normalization — minimum is ${MIN_MEMBERS}`,
        skipped,
      }, 409);
    }

    const objectKey = activationObjectKey(c.slug, dt);

    if (body.dry_run) {
      return json({
        success: true,
        dry_run: true,
        cohort: { slug: c.slug, name: c.name, member_count: c.member_count },
        row_count: eids.length,
        holdout: heldOut,
        skipped,
        object_key: objectKey,
        elapsed_ms: Date.now() - startedAt,
      });
    }

    const payload = await gzip(activationCsv(eids));

    const { data: inserted } = await admin
      .from("sonic_cohort_exports")
      .insert({
        cohort_id: c.id,
        cohort_slug: c.slug,
        organization_id: body.organization_id ?? null,
        activation_id: body.activation_id ?? null,
        object_key: objectKey,
        dt,
        row_count: eids.length,
        bytes: payload.byteLength,
        status: "running",
        started_by: actorId,
      })
      .select("id")
      .single();
    exportRowId = (inserted as { id: string } | null)?.id ?? null;

    await putObject(objectKey, payload, {
      contentType: "text/csv",
      contentEncoding: "gzip",
    });

    if (exportRowId) {
      await admin
        .from("sonic_cohort_exports")
        .update({ status: "succeeded", updated_at: new Date().toISOString() })
        .eq("id", exportRowId);
    }

    // ---- record the run against the org's activation grants -----------------
    // An explicit organization/activation pair from the caller wins. Otherwise
    // the grants are resolved from the exported subjects themselves: whichever
    // Intuizi activations delivered them, limited to grants that are still
    // active. Nothing identifier-shaped is returned — only a count.
    const stamp = {
      last_synced_at: new Date().toISOString(),
      last_export_at: new Date().toISOString(),
      last_export_object_key: objectKey,
      last_export_row_count: eids.length,
    };
    let activationsRecorded = 0;

    if (body.organization_id && body.activation_id) {
      const { data: updated } = await admin
        .from("org_intuizi_activations")
        .update(stamp)
        .eq("organization_id", body.organization_id)
        .eq("activation_id", body.activation_id)
        .select("id");
      activationsRecorded = (updated ?? []).length;
    } else {
      const activationIds = await resolveActivationIds(admin, subjectKeys);
      if (activationIds.length) {
        const { data: updated } = await admin
          .from("org_intuizi_activations")
          .update(stamp)
          .in("activation_id", activationIds)
          .eq("is_active", true)
          .select("id");
        activationsRecorded = (updated ?? []).length;
      }
    }

    const out = {
      success: true,
      cohort: { slug: c.slug, name: c.name, member_count: c.member_count },
      object_key: objectKey,
      dt,
      row_count: eids.length,
      holdout: heldOut,
      bytes: payload.byteLength,
      skipped,
      activations_recorded: activationsRecorded,
      elapsed_ms: Date.now() - startedAt,
    };

    console.log(JSON.stringify({ evt: "activation_export", ...out }));
    return json(out);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    console.error("activation-export failed", msg);
    if (exportRowId) {
      await admin
        .from("sonic_cohort_exports")
        .update({ status: "failed", error: msg, updated_at: new Date().toISOString() })
        .eq("id", exportRowId)
        .catch(() => {});
    }
    return json({ success: false, error: msg }, 500);
  }
});
