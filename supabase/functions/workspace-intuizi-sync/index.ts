// Org-scoped Intuizi sync.
//
// Enterprise workspace members can pull ONLY the Intuizi activations a platform
// admin has explicitly granted to their organization (public.org_intuizi_activations).
// Nothing here exposes the admin-wide ingestion surface: the function reads
// already-ingested + already-scored Intuizi profiles for the granted activations
// and copies them into the org's own enterprise dataset/records.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { AuthzError, requireOrgMember } from "../_shared/org.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const CATEGORIES = [
  "emotional",
  "cognitive",
  "social",
  "communication",
  "contextual",
  "artistic",
] as const;

const CHUNK = 500;
const MAX_ROWS_PER_ACTIVATION = 5000;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

// deno-lint-ignore no-explicit-any
type Admin = any;

/** Object keys carry the activation as `..._activation_id5580_...`. */
const keyPatterns = (activationId: string) => [
  `%activation_id${activationId}%`,
  `%activationid${activationId}%`,
  `%activation-id${activationId}%`,
];

/** Every Intuizi audio source that belongs to one activation. */
async function sourcesForActivation(admin: Admin, activationId: string) {
  const seen = new Map<string, Record<string, unknown>>();
  for (const pattern of keyPatterns(activationId)) {
    const { data, error } = await admin
      .from("audio_sources")
      .select("id,name,ctv_metadata,created_at")
      .eq("source_type", "intuizi")
      .ilike("ctv_metadata->>object_key", pattern)
      .order("created_at", { ascending: false })
      .limit(MAX_ROWS_PER_ACTIVATION);
    if (error) throw new Error(error.message);
    for (const row of data ?? []) seen.set(row.id, row);
  }
  return [...seen.values()];
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const admin = createClient(SUPABASE_URL, SERVICE_KEY);

  try {
    const body = await req.json().catch(() => ({}));
    const organizationId = String(body.organization_id ?? "");
    const action = String(body.action ?? "list");
    // "list" only needs membership; syncing writes data, so require write role.
    const caller = await requireOrgMember(req, admin, organizationId, action !== "list");

    const { data: grants, error: grantErr } = await admin
      .from("org_intuizi_activations")
      .select("id,activation_id,label,notes,is_active,last_synced_at")
      .eq("organization_id", organizationId)
      .eq("is_active", true)
      .order("activation_id", { ascending: false });
    if (grantErr) throw new Error(grantErr.message);

    const granted = grants ?? [];

    if (action === "list") {
      const withCounts = [];
      for (const g of granted) {
        let available = 0;
        try {
          available = (await sourcesForActivation(admin, g.activation_id)).length;
        } catch { /* counting is best-effort */ }
        withCounts.push({ ...g, available_profiles: available });
      }
      return json({ success: true, activations: withCounts });
    }

    if (action !== "sync") throw new AuthzError(`Unknown action: ${action}`, 400);

    const requested = Array.isArray(body.activation_ids)
      ? (body.activation_ids as unknown[]).map((a) => String(a).trim()).filter(Boolean)
      : [];
    if (!requested.length) throw new AuthzError("Select at least one activation to sync", 400);

    const allowed = new Set(granted.map((g) => g.activation_id));
    const denied = requested.filter((a) => !allowed.has(a));
    if (denied.length) {
      throw new AuthzError(
        `Your workspace is not granted access to activation ${denied.join(", ")}`,
        403,
      );
    }

    const results: Record<string, unknown>[] = [];

    for (const activationId of requested) {
      const grant = granted.find((g) => g.activation_id === activationId)!;
      const sources = await sourcesForActivation(admin, activationId);

      if (!sources.length) {
        results.push({
          activation_id: activationId,
          rows_synced: 0,
          scored: 0,
          note: "No ingested profiles found for this activation yet.",
        });
        continue;
      }

      // Latest analysis per source.
      const sourceIds = sources.map((s) => String(s.id));
      const latest = new Map<string, Record<string, unknown>>();
      for (let i = 0; i < sourceIds.length; i += CHUNK) {
        const { data, error } = await admin
          .from("source_analyses")
          .select(
            "audio_source_id,source_name,confidence,created_at," +
              CATEGORIES.map((c) => `${c}_score`).join(","),
          )
          .in("audio_source_id", sourceIds.slice(i, i + CHUNK))
          .order("created_at", { ascending: false });
        if (error) throw new Error(error.message);
        for (const a of data ?? []) {
          const sid = String(a.audio_source_id);
          if (!latest.has(sid)) latest.set(sid, a);
        }
      }

      const datasetName = grant.label?.trim()
        ? grant.label.trim()
        : `Intuizi activation ${activationId}`;

      // Reuse the org's dataset for this activation so repeat syncs refresh it.
      const { data: existingDs } = await admin
        .from("enterprise_datasets")
        .select("id")
        .eq("organization_id", organizationId)
        .eq("source_kind", "intuizi")
        .eq("name", datasetName)
        .maybeSingle();

      let datasetId = existingDs?.id as string | undefined;
      if (datasetId) {
        await admin.from("enterprise_datasets")
          .update({ status: "ingesting" })
          .eq("id", datasetId);
        await admin.from("enterprise_records").delete().eq("dataset_id", datasetId);
      } else {
        const { data: ds, error: dsErr } = await admin
          .from("enterprise_datasets")
          .insert({
            organization_id: organizationId,
            name: datasetName,
            description: grant.notes ?? `Synced from Intuizi activation ${activationId}`,
            source_kind: "intuizi",
            status: "ingesting",
            created_by: caller.userId,
          })
          .select("id")
          .single();
        if (dsErr) throw new Error(`Could not create dataset: ${dsErr.message}`);
        datasetId = ds.id;
      }

      const prepared = sources.map((s) => {
        const meta = (s.ctv_metadata ?? {}) as Record<string, unknown>;
        const ana = latest.get(String(s.id));
        const record: Record<string, unknown> = {
          organization_id: organizationId,
          dataset_id: datasetId,
          external_user_id: meta.identifier ? String(meta.identifier).slice(0, 200) : null,
          source_name: String(s.name ?? "Intuizi profile").slice(0, 300),
          audio_url: null,
          attributes: {
            provider: "intuizi",
            activation_id: activationId,
            report_type: meta.report_type ?? null,
            object_key: meta.object_key ?? null,
          },
          kpi: {},
          analysis_status: ana ? "scored" : "pending",
          score_confidence: ana ? Number(ana.confidence ?? 1) : null,
        };
        for (const c of CATEGORIES) {
          record[`${c}_score`] = ana ? Number(ana[`${c}_score`] ?? 0) : null;
        }
        return record;
      });

      let inserted = 0;
      const failures: string[] = [];
      for (let i = 0; i < prepared.length; i += CHUNK) {
        const slice = prepared.slice(i, i + CHUNK);
        const { error } = await admin.from("enterprise_records").insert(slice);
        if (error) failures.push(`rows ${i + 1}-${i + slice.length}: ${error.message}`);
        else inserted += slice.length;
      }

      const scoredRows = prepared.filter((r) => r.analysis_status === "scored");
      const averages: Record<string, number | null> = {};
      for (const c of CATEGORIES) {
        averages[`${c}_avg`] = scoredRows.length
          ? scoredRows.reduce((s, r) => s + Number(r[`${c}_score`] ?? 0), 0) / scoredRows.length
          : null;
      }

      await admin.from("enterprise_datasets").update({
        row_count: inserted,
        scored_count: scoredRows.length,
        status: failures.length ? "partial" : "ready",
        ...averages,
      }).eq("id", datasetId);

      await admin.from("org_intuizi_activations")
        .update({ last_synced_at: new Date().toISOString() })
        .eq("id", grant.id);

      results.push({
        activation_id: activationId,
        dataset_id: datasetId,
        rows_synced: inserted,
        scored: scoredRows.length,
        failures,
      });
    }

    return json({ success: true, results });
  } catch (e) {
    const status = e instanceof AuthzError ? e.status : 500;
    console.error("workspace-intuizi-sync failed:", (e as Error).message);
    return json({ success: false, error: (e as Error).message }, status);
  }
});
