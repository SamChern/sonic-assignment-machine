// Scoring worker for one enterprise account's OWN data.
//
// Unlike `enterprise-score-dataset` (one dataset, called from the upload
// screen), this worker sweeps every dataset the account owns that still has
// pending rows, scores them in bounded batches, refreshes each dataset's
// roll-up, and records the run in `org_scoring_runs` so the workspace can show
// confidence numbers that came from the account's own feeds.
//
// Actions:
//   run  — organization-scoped, called by an owner/analyst (or admin).
//   tick — internal only (service key / cron): sweeps every organization that
//          still has pending rows, oldest waiting first.
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

type Admin = ReturnType<typeof createClient>;
type ScoreSet = Record<string, number>;

// Bounds so a single invocation always finishes inside the function timeout.
const BATCH = 500;
const MAX_BATCHES_PER_DATASET = 4;
const MAX_DATASETS_PER_RUN = 10;
const MAX_ORGS_PER_TICK = 5;

interface DatasetOutcome {
  dataset_id: string;
  name: string | null;
  processed: number;
  scored: number;
  unresolved: number;
  scored_total: number;
  avg_confidence: number | null;
}

/**
 * Resolves one batch of pending rows against analyses the platform already
 * holds. Exact name matching only — an ILIKE here would let a row named "%"
 * borrow another tenant's analysis.
 */
async function scoreBatch(
  admin: Admin,
  organizationId: string,
  datasetId: string,
): Promise<{ processed: number; scored: number; unresolved: number }> {
  const { data: pending, error: pendErr } = await admin
    .from("enterprise_records")
    .select("id, source_name, audio_url")
    .eq("organization_id", organizationId)
    .eq("dataset_id", datasetId)
    .eq("analysis_status", "pending")
    .limit(BATCH);
  if (pendErr) throw new Error(pendErr.message);

  const records = pending ?? [];
  if (!records.length) return { processed: 0, scored: 0, unresolved: 0 };

  const names = Array.from(
    new Set(records.map((r) => String(r.source_name ?? "").trim()).filter((n) => n.length > 0)),
  );

  const priorByName = new Map<string, { scores: ScoreSet; confidence: number }>();
  const cacheByName = new Map<string, ScoreSet>();

  if (names.length) {
    const { data: priors } = await admin
      .from("source_analyses")
      .select(
        "source_name, emotional_score, cognitive_score, social_score, communication_score, contextual_score, artistic_score, confidence, created_at",
      )
      .in("source_name", names)
      .order("created_at", { ascending: false });

    for (const p of priors ?? []) {
      const key = String(p.source_name ?? "").trim();
      if (!key || priorByName.has(key)) continue; // newest analysis wins
      const s: ScoreSet = {};
      for (const c of CATEGORIES) s[c] = Number(p[`${c}_score`]);
      priorByName.set(key, { scores: s, confidence: Number(p.confidence ?? 0.6) });
    }

    const missing = names.filter((n) => !priorByName.has(n));
    if (missing.length) {
      const { data: cached } = await admin
        .from("source_cache")
        .select(
          "source_name, emotional_score, cognitive_score, social_score, communication_score, contextual_score, artistic_score",
        )
        .in("source_name", missing);
      for (const row of cached ?? []) {
        const key = String(row.source_name ?? "").trim();
        if (!key || cacheByName.has(key)) continue;
        const s: ScoreSet = {};
        for (const c of CATEGORIES) s[c] = Number(row[`${c}_score`]);
        cacheByName.set(key, s);
      }
    }
  }

  const updates: Record<string, unknown>[] = [];
  let scored = 0;
  let unresolved = 0;

  for (const rec of records) {
    const name = String(rec.source_name ?? "").trim();
    const prior = name ? priorByName.get(name) : undefined;
    const cacheHit = !prior && name ? cacheByName.get(name) : undefined;
    const scores = prior?.scores ?? cacheHit ?? null;

    // An upsert is an insert when it misses, so every payload carries the row's
    // NOT NULL owner columns — without them PostgREST rejects the whole batch.
    const owner = { organization_id: organizationId, dataset_id: datasetId };

    if (!scores) {
      unresolved += 1;
      updates.push({
        ...owner,
        id: rec.id,
        source_name: rec.source_name,
        analysis_status: "unresolved",
        analysis_error: rec.audio_url
          ? "Audio link present but not yet analysed — run the audio pipeline for this source"
          : "No matching analysed source. Add a source_name that exists in SonicSIM, or an audio link.",
      });
      continue;
    }

    const update: Record<string, unknown> = {
      ...owner,
      id: rec.id,
      source_name: rec.source_name,
      analysis_status: "scored",
      analysis_error: null,
      // A cache hit carries no per-analysis confidence, so it lands lower than
      // a real prior analysis rather than borrowing its number.
      score_confidence: prior ? prior.confidence : 0.5,
    };
    for (const c of CATEGORIES) update[`${c}_score`] = scores[c];
    updates.push(update);
    scored += 1;
  }

  for (let i = 0; i < updates.length; i += 500) {
    const chunk = updates.slice(i, i + 500);
    const { error } = await admin
      .from("enterprise_records")
      .upsert(chunk, { onConflict: "id" });
    if (error) throw new Error(error.message);
  }

  return { processed: records.length, scored, unresolved };
}

/** Recomputes one dataset's stored roll-up from all of its scored rows. */
async function refreshDatasetRollup(
  admin: Admin,
  organizationId: string,
  datasetId: string,
): Promise<{ scored_total: number; avg_confidence: number | null }> {
  const { data: allScored } = await admin
    .from("enterprise_records")
    .select(
      "score_confidence, emotional_score, cognitive_score, social_score, communication_score, contextual_score, artistic_score",
    )
    .eq("organization_id", organizationId)
    .eq("dataset_id", datasetId)
    .eq("analysis_status", "scored")
    .limit(20000);

  const rows = allScored ?? [];
  const averages: Record<string, number | null> = {};
  for (const c of CATEGORIES) {
    averages[`${c}_avg`] = rows.length
      ? rows.reduce((s, r) => s + Number(r[`${c}_score`] ?? 0), 0) / rows.length
      : null;
  }
  const confRows = rows.filter((r) => r.score_confidence !== null);
  const avgConfidence = confRows.length
    ? confRows.reduce((s, r) => s + Number(r.score_confidence), 0) / confRows.length
    : null;

  const { count } = await admin
    .from("enterprise_records")
    .select("id", { count: "exact", head: true })
    .eq("dataset_id", datasetId);

  await admin
    .from("enterprise_datasets")
    .update({
      scored_count: rows.length,
      row_count: count ?? rows.length,
      status: "ready",
      ...averages,
    })
    .eq("id", datasetId);

  return { scored_total: rows.length, avg_confidence: avgConfidence };
}

/** Scores every dataset of one organization that still has pending rows. */
async function runForOrg(
  admin: Admin,
  organizationId: string,
  opts: { triggerSource: string; datasetId?: string },
) {
  const { data: runRow, error: runErr } = await admin
    .from("org_scoring_runs")
    .insert({
      organization_id: organizationId,
      dataset_id: opts.datasetId ?? null,
      trigger_source: opts.triggerSource,
      status: "running",
    })
    .select("id")
    .single();
  if (runErr) throw new Error(runErr.message);
  const runId = (runRow as { id: string }).id;

  try {
    let datasetIds: string[] = [];
    if (opts.datasetId) {
      datasetIds = [opts.datasetId];
    } else {
      const { data: pendingDatasets, error } = await admin
        .from("enterprise_records")
        .select("dataset_id")
        .eq("organization_id", organizationId)
        .eq("analysis_status", "pending")
        .limit(5000);
      if (error) throw new Error(error.message);
      datasetIds = Array.from(
        new Set((pendingDatasets ?? []).map((r) => String(r.dataset_id))),
      ).slice(0, MAX_DATASETS_PER_RUN);
    }

    const outcomes: DatasetOutcome[] = [];
    let processed = 0;
    let scored = 0;
    let unresolved = 0;

    for (const datasetId of datasetIds) {
      const { data: ds } = await admin
        .from("enterprise_datasets")
        .select("id, name")
        .eq("id", datasetId)
        .eq("organization_id", organizationId)
        .maybeSingle();
      if (!ds) continue; // dataset belongs to another account — never touch it

      let dProcessed = 0;
      let dScored = 0;
      let dUnresolved = 0;
      for (let b = 0; b < MAX_BATCHES_PER_DATASET; b += 1) {
        const res = await scoreBatch(admin, organizationId, datasetId);
        dProcessed += res.processed;
        dScored += res.scored;
        dUnresolved += res.unresolved;
        if (res.processed < BATCH) break; // no pending rows left
      }

      const rollup = await refreshDatasetRollup(admin, organizationId, datasetId);
      outcomes.push({
        dataset_id: datasetId,
        name: (ds as { name: string | null }).name,
        processed: dProcessed,
        scored: dScored,
        unresolved: dUnresolved,
        ...rollup,
      });
      processed += dProcessed;
      scored += dScored;
      unresolved += dUnresolved;
    }

    const confs = outcomes
      .map((o) => o.avg_confidence)
      .filter((v): v is number => typeof v === "number");
    const avgConfidence = confs.length ? confs.reduce((s, v) => s + v, 0) / confs.length : null;

    await admin
      .from("org_scoring_runs")
      .update({
        status: "completed",
        datasets_touched: outcomes.length,
        processed,
        scored,
        unresolved,
        avg_confidence: avgConfidence,
        finished_at: new Date().toISOString(),
      })
      .eq("id", runId);

    return {
      run_id: runId,
      organization_id: organizationId,
      datasets_touched: outcomes.length,
      processed,
      scored,
      unresolved,
      avg_confidence: avgConfidence,
      datasets: outcomes,
    };
  } catch (e) {
    await admin
      .from("org_scoring_runs")
      .update({
        status: "failed",
        error: (e as Error).message.slice(0, 500),
        finished_at: new Date().toISOString(),
      })
      .eq("id", runId);
    throw e;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const admin = createClient(SUPABASE_URL, SERVICE_KEY);

  try {
    const body = await req.json().catch(() => ({}));
    const action = String(body.action ?? "run");

    if (action === "tick") {
      // Cron path: only an internal caller may sweep across accounts — either
      // the service key or the dedicated scheduled-job secret.
      const bearer = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
      const jobSecret = Deno.env.get("INTERNAL_CRON_SECRET");
      const presented = req.headers.get("x-internal-cron-secret");
      const secretOk = Boolean(
        jobSecret && presented && presented.length === jobSecret.length && presented === jobSecret,
      );
      if (!secretOk && bearer !== SERVICE_KEY) throw new AuthzError("Internal action", 403);

      const { data: waiting, error } = await admin
        .from("enterprise_records")
        .select("organization_id")
        .eq("analysis_status", "pending")
        .order("created_at", { ascending: true })
        .limit(5000);
      if (error) throw new Error(error.message);

      const orgIds = Array.from(
        new Set((waiting ?? []).map((r) => String(r.organization_id))),
      ).slice(0, MAX_ORGS_PER_TICK);

      const results = [];
      for (const orgId of orgIds) {
        try {
          results.push(await runForOrg(admin, orgId, { triggerSource: "scheduled" }));
        } catch (e) {
          results.push({ organization_id: orgId, error: (e as Error).message });
        }
      }
      return new Response(
        JSON.stringify({ success: true, organizations: orgIds.length, results }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (action !== "run") throw new AuthzError(`Unknown action: ${action}`, 400);

    const organizationId = String(body.organization_id ?? "");
    await requireOrgMember(req, admin, organizationId, true);
    const datasetId = body.dataset_id ? String(body.dataset_id) : undefined;

    const result = await runForOrg(admin, organizationId, {
      triggerSource: "manual",
      datasetId,
    });
    return new Response(JSON.stringify({ success: true, ...result }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    const status = e instanceof AuthzError ? e.status : 500;
    console.error("enterprise-score-worker failed:", (e as Error).message);
    return new Response(JSON.stringify({ success: false, error: (e as Error).message }), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
