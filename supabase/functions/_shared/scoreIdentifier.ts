// Shared per-identifier ontology scoring.
//
// The Intuizi ingest run used to read Parquet, normalize rows AND score every
// identifier through analyze-audio inside one edge invocation. Scoring is the
// expensive tail (AI gateway round-trips + embeddings), so the run reliably hit
// the wall-clock budget or a WORKER_RESOURCE_LIMIT kill before producing a
// single analysis row.
//
// Scoring now lives here so two callers can share it:
//   - `intuizi-ingest`   — enqueues work (cheap) and may score one probe row.
//   - `intuizi-score-worker` — drains `public.intuizi_score_queue` in small,
//     self-chaining batches, so total pipeline time is unbounded while any one
//     invocation stays far inside the CPU / time limits.

import {
  buildTaxonomyContext,
  CATEGORIES,
  type Category,
  embed,
  type OntologyTag,
  resolveTag,
  updateCalibration,
} from "./ontology.ts";
import {
  applyNormalizationToAnalysis,
  loadNormalization,
} from "./normalization.ts";
import {
  backoffFor,
  classifyFailure,
  type FailureVerdict,
  httpStatusOf,
  messageOf,
  newTraceId,
  stageOf,
  tagStage,
} from "./failure.ts";

export { classifyFailure, newTraceId, stageOf };
export type { FailureVerdict };


type Json = Record<string, unknown>;

/** Signal column per Intuizi report type (mirrors intuizi_identifiers schema). */
export const SIGNAL_COLUMN: Record<string, string> = {
  ctv: "ctv_signals",
  apps: "apps_signals",
  visitation: "visitation_signals",
  demographics: "demographics_signals",
  origin: "origin_signals",
};

export function signalColumn(reportType: string): string {
  return SIGNAL_COLUMN[reportType] ?? "ctv_signals";
}


export function statusOf(e: unknown): number | undefined {
  return httpStatusOf(e);
}

export function errMsg(e: unknown): string {
  return messageOf(e);
}


/** Rate-limit / retry telemetry for one invocation. */
export function createRateMetrics() {
  return {
    attempts: 0,
    retries: 0,
    rateLimited: 0,
    terminal: 0,
    byReport: {} as Record<string, number>,
    retryAfterMs: [] as number[],
    snapshot() {
      return {
        analyze_attempts: this.attempts,
        analyze_retries: this.retries,
        rate_limited_calls: this.rateLimited,
        terminal_errors: this.terminal,
        rate_limits_by_report_type: this.byReport,
      };
    },
  };
}
export type RateMetrics = ReturnType<typeof createRateMetrics>;

/**
 * Invoke `analyze-audio` with classified, adaptive retries.
 *
 * - resource / timeout failures re-run with a SMALLER payload (the taxonomy
 *   context is the only part that scales), because the same payload would be
 *   killed the same way again;
 * - rate limits back off using the gateway's own hint;
 * - schema / credits / policy / auth failures fail fast with a clear reason
 *   instead of consuming the attempt budget.
 */
// deno-lint-ignore no-explicit-any
export async function invokeAnalyzeAudio(
  // deno-lint-ignore no-explicit-any
  admin: any,
  body: Json,
  reportType = "unknown",
  metrics: RateMetrics = createRateMetrics(),
  opts: { traceId?: string; stepScale?: number } = {},
  // deno-lint-ignore no-explicit-any
): Promise<any> {
  const MAX_ATTEMPTS = 4;
  /** Context budget shrinks on every resource failure (never below 25%). */
  let scale = Math.min(Math.max(opts.stepScale ?? 1, 0.25), 1);
  let lastErr: unknown = null;

  const shrinkBody = (b: Json): Json => {
    if (scale >= 1) return b;
    const sources = (b.sources as Array<Record<string, unknown>> | undefined) ?? [];
    return {
      ...b,
      sources: sources.map((s) => {
        const ctx = typeof s.taxonomy_context === "string" ? s.taxonomy_context : "";
        const keep = Math.max(400, Math.floor(ctx.length * scale));
        return ctx.length > keep ? { ...s, taxonomy_context: ctx.slice(0, keep) } : s;
      }),
    };
  };

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    metrics.attempts++;
    const { data, error } = await admin.functions.invoke("analyze-audio", {
      body: shrinkBody(body),
    });
    if (!error) {
      if (!data?.sources?.[0]) throw new Error("analyze-audio returned no source");
      return data;
    }
    lastErr = error;
    const verdict = classifyFailure(error);
    if (verdict.kind === "rate_limit") {
      metrics.rateLimited++;
      metrics.byReport[reportType] = (metrics.byReport[reportType] ?? 0) + 1;
      metrics.retryAfterMs.push(verdict.backoffMs);
    }
    if (!verdict.retryable) metrics.terminal++;

    if (!verdict.retryable || attempt === MAX_ATTEMPTS) {
      console.log(JSON.stringify({
        evt: "analyze_audio_giving_up",
        trace_id: opts.traceId ?? null,
        report_type: reportType,
        attempt,
        status: verdict.status ?? null,
        failure_kind: verdict.kind,
        step_scale: scale,
        reason: verdict.reason.slice(0, 300),
      }));
      break;
    }

    if (verdict.shrink) scale = Math.max(0.25, scale * 0.5);
    metrics.retries++;
    const wait = backoffFor(verdict, attempt);
    console.log(JSON.stringify({
      evt: "analyze_audio_retry",
      trace_id: opts.traceId ?? null,
      report_type: reportType,
      attempt,
      failure_kind: verdict.kind,
      backoff_ms: wait,
      next_step_scale: scale,
    }));
    await new Promise((r) => setTimeout(r, wait));
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}


/** One queued scoring task (shape of `public.intuizi_score_queue`). */
export interface ScoreTask {
  object_key: string;
  report_type: string;
  identifier: string;
  owner_id: string | null;
  label?: string | null;
  tags: OntologyTag[];
  signals: Json[];
  confidence: number;
  /** Correlates ingest, the queue row and every worker attempt in the logs. */
  trace_id?: string | null;
  /** <1 shrinks the per-identifier workload after a compute/timeout failure. */
  step_scale?: number | null;
}

export interface ScoreOutcome {
  status: "scored" | "unchanged";
  audio_source_id: string | null;
  scores?: Record<string, number>;
  /** Last stage completed — persisted so a resume can skip finished work. */
  stage: ScoreStage;
  trace_id: string;
}

export type ScoreStage =
  | "lookup"
  | "source"
  | "tags"
  | "context"
  | "analyze"
  | "normalize"
  | "learn"
  | "persist"
  | "done";

export interface ScoreOptions {
  traceId?: string;
  stepScale?: number;
  onStage?: (stage: ScoreStage) => void;
}

/**
 * Score one identifier through the ontology and persist everything the app and
 * the continuous-learning loop need. Idempotent: an identifier whose tag set is
 * already covered short-circuits as `unchanged`.
 *
 * Every error that escapes carries the stage it failed in (`e.stage`) and the
 * run's `trace_id`, so the queue row and the logs point at the same identifier.
 */
// deno-lint-ignore no-explicit-any
export async function scoreIdentifier(
  // deno-lint-ignore no-explicit-any
  admin: any,
  task: ScoreTask,
  metrics: RateMetrics = createRateMetrics(),
  opts: ScoreOptions = {},
): Promise<ScoreOutcome> {
  const traceId = opts.traceId ?? task.trace_id ?? newTraceId();
  const stepScale = Math.min(Math.max(opts.stepScale ?? task.step_scale ?? 1, 0.25), 1);
  let stage: ScoreStage = "lookup";
  const enter = (s: ScoreStage) => {
    stage = s;
    opts.onStage?.(s);
  };

  try {
    return await runScore(admin, task, metrics, { traceId, stepScale, enter, stageRef: () => stage });
  } catch (e) {
    tagStage(e, stage);
    console.error(JSON.stringify({
      evt: "score_identifier_failed",
      trace_id: traceId,
      identifier: task.identifier,
      report_type: task.report_type,
      stage,
      step_scale: stepScale,
      failure_kind: classifyFailure(e).kind,
      message: errMsg(e).slice(0, 300),
    }));
    throw e;
  }
}

// deno-lint-ignore no-explicit-any
async function runScore(
  // deno-lint-ignore no-explicit-any
  admin: any,
  task: ScoreTask,
  metrics: RateMetrics,
  ctx: {
    traceId: string;
    stepScale: number;
    enter: (s: ScoreStage) => void;
    stageRef: () => ScoreStage;
  },
): Promise<ScoreOutcome> {
  const { traceId, stepScale, enter } = ctx;
  enter("lookup");
  const { data: existing } = await admin
    .from("intuizi_identifiers")
    .select("id,audio_source_id,tag_codes,observation_count")
    .eq("primary_identifier", task.identifier)
    .maybeSingle();

  const tags = task.tags ?? [];
  const tagCodes = tags.map((t) => t.code);
  const previousCodes: string[] = existing?.tag_codes ?? [];
  const unchanged = previousCodes.length > 0 &&
    tagCodes.every((c) => previousCodes.includes(c));
  if (unchanged) {
    return {
      status: "unchanged",
      audio_source_id: existing?.audio_source_id ?? null,
      stage: "done",
      trace_id: traceId,
    };
  }
  enter("source");


  const label = task.label ??
    `Intuizi ${task.report_type}: ${task.identifier.slice(0, 12)}`;

  // 1. audio_sources row (reused across runs per identifier)
  let audioSourceId: string | null = existing?.audio_source_id ?? null;
  if (!audioSourceId) {
    const { data: src, error: srcErr } = await admin
      .from("audio_sources")
      .insert({
        user_id: task.owner_id,
        source_type: "intuizi",
        name: label,
        ctv_metadata: {
          provider: "intuizi",
          report_type: task.report_type,
          object_key: task.object_key,
          identifier: task.identifier,
          signals: task.signals,
        },
      })
      .select("id").single();
    if (srcErr) throw srcErr;
    audioSourceId = src.id;
  }

  // 2. Taxonomy tags
  const nodeIds: string[] = [];
  for (const t of tags) {
    try {
      nodeIds.push(await resolveTag(admin, t));
    } catch (e) {
      if ([402, 403, 429].includes(statusOf(e) ?? 0)) throw e;
      console.warn("tag resolve failed", t.code, errMsg(e));
    }
  }
  if (nodeIds.length) {
    await admin.from("audio_source_tags").upsert(
      nodeIds.map((nid) => ({
        audio_source_id: audioSourceId,
        node_id: nid,
        weight: task.confidence,
      })),
      { onConflict: "audio_source_id,node_id" },
    );
  }

  // 3. Calibration priors + kNN warm start
  let taxonomyContext = await buildTaxonomyContext(admin, nodeIds);
  const queryEmbedding = await embed(
    `intuizi ${task.report_type}; tags: ${tagCodes.join(",")}`,
  );
  if (queryEmbedding) {
    const { data: neighbors } = await admin.rpc("match_audio_profiles", {
      query_embedding: queryEmbedding,
      match_count: 5,
      exclude_id: audioSourceId,
    });
    if (neighbors?.length) {
      // deno-lint-ignore no-explicit-any
      const lines = neighbors.map((n: any) =>
        `  - ${n.name} (sim=${Number(n.similarity).toFixed(2)}): ` +
        `emo=${Math.round(n.emotional_score)} cog=${Math.round(n.cognitive_score)} ` +
        `soc=${Math.round(n.social_score)} com=${Math.round(n.communication_score)} ` +
        `ctx=${Math.round(n.contextual_score)} art=${Math.round(n.artistic_score)}`
      ).join("\n");
      taxonomyContext = `${taxonomyContext}\nnearest_neighbors:\n${lines}`;
    }
  }

  // 4. Score through the same ontology path as music sources
  const ana = await invokeAnalyzeAudio(admin, {
    sources: [{
      name: label,
      type: "file",
      audio_source_id: audioSourceId,
      taxonomy_context: taxonomyContext,
    }],
    user_id: task.owner_id,
    save_results: true,
  }, task.report_type, metrics);

  const sourceOut = ana.sources[0];
  const scoreMap = {} as Record<Category, number>;
  for (const c of sourceOut.categories ?? []) {
    scoreMap[(c.name ?? "").toLowerCase() as Category] = Number(c.score) || 0;
  }

  // 4b. Speech-skew normalization for vocal-heavy Intuizi feeds.
  const normCfg = await loadNormalization(admin, "intuizi");
  const normScores = await applyNormalizationToAnalysis(
    admin,
    audioSourceId!,
    scoreMap,
    normCfg,
  );
  for (const c of CATEGORIES) scoreMap[c] = normScores[c] ?? scoreMap[c];

  // 5. Continuous learning: calibration + profile embedding
  await updateCalibration(admin, nodeIds, scoreMap);
  const profileEmbedding = await embed(
    `intuizi ${task.report_type}; tags: ${tagCodes.join(",")}; ` +
    `scores: ${CATEGORIES.map((c) => `${c}=${scoreMap[c] ?? "?"}`).join(",")}`,
  );
  if (profileEmbedding) {
    await admin.from("audio_sources")
      .update({ profile_embedding: profileEmbedding })
      .eq("id", audioSourceId);
  }

  // 6. Idempotent progress marking, in the same step as the work
  const mergedCodes = Array.from(new Set([...previousCodes, ...tagCodes]));
  await admin.from("intuizi_identifiers").upsert({
    primary_identifier: task.identifier,
    [signalColumn(task.report_type)]: {
      rows: task.signals,
      confidence: task.confidence,
      scores: scoreMap,
      object_key: task.object_key,
      scored_at: new Date().toISOString(),
    },
    tag_codes: mergedCodes,
    audio_source_id: audioSourceId,
    observation_count: (existing?.observation_count ?? 0) + (task.signals?.length ?? 0),
    last_seen_at: new Date().toISOString(),
  }, { onConflict: "primary_identifier" });

  return { status: "scored", audio_source_id: audioSourceId, scores: scoreMap };
}
