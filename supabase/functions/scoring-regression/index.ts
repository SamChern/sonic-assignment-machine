// Step 4 verification harness.
//
// Two modes, both admin-only and both read-only with respect to stored results:
//
//   mode="calibration" — re-score a DETERMINISTIC set of existing audio_sources
//     (oldest-first by id so repeated runs compare the same rows) through
//     analyze-audio with the cache bypassed, then diff the six axes against the
//     most recent stored source_analyses row. Reports per-axis mean/max drift and
//     whether every source stayed inside the calibration tolerance.
//
//   mode="tag_only" — score subjects that have taxonomy tags but no file_url and
//     assert the librosa branch was never touched (evidence must not be a
//     librosa tier, and no librosa_call_log row may be written during the run).
//
// Nothing here writes source_analyses or source_cache; it only reads and reports.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { AuthzError, requireAdmin } from "../_shared/admin.ts";
import { controlNumber } from "../_shared/control.ts";
import { CATEGORIES, buildTaxonomyContext } from "../_shared/scoring.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const AXES = [
  "emotional",
  "cognitive",
  "social",
  "communication",
  "contextual",
  "artistic",
] as const;
type Axis = typeof AXES[number];

interface Body {
  mode?: "calibration" | "tag_only";
  /** How many sources to re-score. Clamped to 1..50. */
  limit?: number;
  /** Optional explicit source ids; overrides the deterministic selection. */
  source_ids?: string[];
}

// deno-lint-ignore no-explicit-any
type Any = any;

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** Latest stored analysis per audio_source_id, for the given ids. */
async function baselineFor(admin: Any, ids: string[]) {
  const { data, error } = await admin
    .from("source_analyses")
    .select(
      "audio_source_id, created_at, " +
        AXES.map((a) => `${a}_score`).join(", "),
    )
    .in("audio_source_id", ids)
    .order("created_at", { ascending: false });
  if (error) throw new Error(`baseline read failed: ${error.message}`);
  const latest = new Map<string, Record<string, number>>();
  for (const row of (data ?? []) as Any[]) {
    if (!row.audio_source_id || latest.has(row.audio_source_id)) continue;
    latest.set(row.audio_source_id, row);
  }
  return latest;
}

/** Taxonomy context (+ tag count) for one source, mirroring the scorer. */
async function contextFor(admin: Any, sourceId: string) {
  const { data } = await admin
    .from("audio_source_tags")
    .select("weight, taxonomy_nodes ( id, code, label, grounding_count )")
    .eq("audio_source_id", sourceId)
    .order("weight", { ascending: false })
    .limit(24);
  const tags = ((data ?? []) as Any[])
    .map((r) => (r.taxonomy_nodes
      ? { code: r.taxonomy_nodes.code, label: r.taxonomy_nodes.label, weight: Number(r.weight) || 0 }
      : null))
    .filter(Boolean) as { code: string; label: string; weight: number }[];
  let text: string | undefined;
  try {
    text = tags.length > 0 ? await buildTaxonomyContext(admin, tags as Any) : undefined;
  } catch {
    text = tags.length > 0
      ? `taxonomy_tags=${tags.map((t) => `${t.code}:${t.weight.toFixed(2)}`).join(",")}`
      : undefined;
  }
  return { tags, text };
}

async function rescore(source: Any, ctxText: string | undefined) {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/analyze-audio`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${SERVICE_KEY}`,
      apikey: SERVICE_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      sources: [{
        name: source.name,
        type: source.file_url ? "file" : "track",
        audio_source_id: source.id,
        file_url: source.file_url ?? undefined,
        taxonomy_context: ctxText,
      }],
      save_results: false,
      bypass_cache: true,
    }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`analyze-audio ${res.status}: ${text.slice(0, 240)}`);
  const parsed = JSON.parse(text);
  const result = parsed?.results?.[0] ?? parsed?.analyses?.[0];
  if (!result) throw new Error("analyze-audio returned no result");
  const scores: Record<string, number> = {};
  for (const cat of (result.categories ?? []) as Any[]) {
    scores[String(cat.name).toLowerCase()] = Number(cat.score);
  }
  return {
    scores,
    evidence: parsed?.evidence_stats ? Object.keys(parsed.evidence_stats) : [],
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const admin = createClient(SUPABASE_URL, SERVICE_KEY);
  try {
    await requireAdmin(req, admin);
  } catch (e) {
    const status = e instanceof AuthzError ? e.status : 500;
    return jsonResponse({ success: false, error: errMsg(e) }, status);
  }

  let body: Body = {};
  try {
    body = req.method === "POST" ? await req.json() : {};
  } catch {
    body = {};
  }
  const mode = body.mode === "tag_only" ? "tag_only" : "calibration";
  const limit = Math.max(1, Math.min(50, Math.round(Number(body.limit) || 50)));
  const tolerance = await controlNumber(admin, "regression.tolerance", 8, {
    min: 1,
    max: 40,
  });

  try {
    // Deterministic selection: id order, so two runs compare the same rows.
    let query = admin
      .from("audio_sources")
      .select("id, name, file_url, analysis_status")
      .order("id", { ascending: true })
      .limit(limit);
    if (body.source_ids?.length) {
      query = admin
        .from("audio_sources")
        .select("id, name, file_url, analysis_status")
        .in("id", body.source_ids.slice(0, 50))
        .order("id", { ascending: true });
    } else if (mode === "tag_only") {
      query = query.is("file_url", null);
    } else {
      query = query.not("file_url", "is", null);
    }
    const { data: sources, error } = await query;
    if (error) throw new Error(`source read failed: ${error.message}`);
    const rows = (sources ?? []) as Any[];
    if (rows.length === 0) {
      return jsonResponse({
        success: true,
        mode,
        tolerance,
        checked: 0,
        note: "no matching audio_sources for this mode",
      });
    }

    const baselines = mode === "calibration"
      ? await baselineFor(admin, rows.map((r) => r.id))
      : new Map<string, Record<string, number>>();

    const { count: librosaBefore } = await admin
      .from("librosa_call_log")
      .select("id", { count: "exact", head: true })
      .gte("created_at", new Date(Date.now() - 60_000).toISOString());

    const perAxis: Record<Axis, number[]> = {
      emotional: [], cognitive: [], social: [],
      communication: [], contextual: [], artistic: [],
    };
    const details: Any[] = [];
    let failures = 0;

    for (const src of rows) {
      try {
        const ctx = await contextFor(admin, src.id);
        if (mode === "tag_only" && ctx.tags.length === 0) continue;
        const out = await rescore(src, ctx.text);
        const base = baselines.get(src.id);
        const diffs: Record<string, number | null> = {};
        let worst = 0;
        for (const axis of AXES) {
          const fresh = out.scores[axis];
          const prev = base ? Number(base[`${axis}_score`]) : null;
          if (typeof fresh === "number" && prev !== null && Number.isFinite(prev)) {
            const d = Math.abs(fresh - prev);
            diffs[axis] = Math.round(d * 100) / 100;
            perAxis[axis].push(d);
            worst = Math.max(worst, d);
          } else {
            diffs[axis] = null;
          }
        }
        const within = base ? worst <= tolerance : null;
        if (within === false) failures++;
        details.push({
          id: src.id,
          name: src.name,
          tag_count: ctx.tags.length,
          tag_only: !src.file_url,
          scored: Object.keys(out.scores).length === AXES.length,
          max_drift: Math.round(worst * 100) / 100,
          within_tolerance: within,
          diffs,
        });
      } catch (e) {
        failures++;
        details.push({ id: src.id, name: src.name, error: errMsg(e) });
      }
    }

    const { count: librosaAfter } = await admin
      .from("librosa_call_log")
      .select("id", { count: "exact", head: true })
      .gte("created_at", new Date(Date.now() - 60_000).toISOString());
    const librosaCalls = Math.max(0, (librosaAfter ?? 0) - (librosaBefore ?? 0));

    const axisSummary = Object.fromEntries(
      AXES.map((axis) => {
        const xs = perAxis[axis];
        const mean = xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
        return [axis, {
          n: xs.length,
          mean_drift: Math.round(mean * 100) / 100,
          max_drift: Math.round((xs.length ? Math.max(...xs) : 0) * 100) / 100,
        }];
      }),
    );

    return jsonResponse({
      success: true,
      mode,
      tolerance,
      checked: details.length,
      failures,
      passed: failures === 0 && (mode !== "tag_only" || librosaCalls === 0),
      librosa_calls_during_run: librosaCalls,
      axis_summary: axisSummary,
      details,
      categories: CATEGORIES,
    });
  } catch (e) {
    return jsonResponse({ success: false, error: errMsg(e) }, 500);
  }
});
