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


/** Cached system-owner lookup for provider rows that carry no end user. */
let systemOwnerCache: { id: string | null; at: number } | null = null;

// deno-lint-ignore no-explicit-any
export async function systemOwnerId(admin: any): Promise<string | null> {
  if (systemOwnerCache && Date.now() - systemOwnerCache.at < 60_000) {
    return systemOwnerCache.id;
  }
  let id: string | null = null;
  const { data: reg } = await admin
    .from("control_registry")
    .select("value")
    .eq("key", "ingest.system_owner_user_id")
    .maybeSingle();
  const raw = reg?.value;
  if (typeof raw === "string" && raw.length > 10) id = raw;

  if (!id) {
    const { data: adminRole } = await admin
      .from("user_roles")
      .select("user_id")
      .eq("role", "admin")
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    id = adminRole?.user_id ?? null;
  }
  systemOwnerCache = { id, at: Date.now() };
  return id;
}


export function statusOf(e: unknown): number | undefined {
  return httpStatusOf(e);
}

export function errMsg(e: unknown): string {
  return messageOf(e);
}

/**
 * Stable signature for a tag set: the semantic score depends only on WHICH
 * ontology codes are present, not on their order or on which device carried
 * them, so sort + hash is the correct cache key.
 */
export async function tagSignatureOf(
  reportType: string,
  tagCodes: string[],
): Promise<string> {
  const canonical = `${reportType}|${[...new Set(tagCodes)].sort().join(",")}`;
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(canonical),
  );
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * `supabase.functions.invoke` surfaces every non-2xx as the useless string
 * "Edge Function returned a non-2xx status code" and hides the real body on
 * `error.context` (a Response). That is why 161 dead letters were classified
 * `unknown`: the gateway's actual reason never reached `classifyFailure`.
 * Reading the body once here makes those failures classifiable (and therefore
 * correctly retryable or correctly paused).
 */
async function enrichInvokeError(error: unknown): Promise<unknown> {
  // deno-lint-ignore no-explicit-any
  const ctx = (error as any)?.context;
  if (!ctx || typeof ctx.text !== "function") return error;
  try {
    const body = (await ctx.clone().text()).slice(0, 800);
    // deno-lint-ignore no-explicit-any
    const e = error as any;
    if (typeof ctx.status === "number") e.status = ctx.status;
    if (body) e.message = `${messageOf(error)} :: ${body}`;
  } catch { /* body already consumed — keep the original error */ }
  return error;
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
    lastErr = await enrichInvokeError(error);
    const verdict = classifyFailure(lastErr);
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

  // Provider feeds carry no end user, so ownership falls back to the system
  // owner (Control Room `ingest.system_owner_user_id`, else the first admin).
  // Without it `audio_sources.user_id` is null and every task dies on a schema
  // error instead of being scored.
  const ownerId = task.owner_id ?? await systemOwnerId(admin);
  if (!ownerId) {
    throw new Error(
      "no owner for Intuizi source: set ingest.system_owner_user_id in the Control Room",
    );
  }

  // 1. audio_sources row (reused across runs per identifier)
  let audioSourceId: string | null = existing?.audio_source_id ?? null;
  if (!audioSourceId) {
    const { data: src, error: srcErr } = await admin
      .from("audio_sources")
      .insert({
        user_id: ownerId,

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
  enter("tags");
  const nodeIds: string[] = [];
  let suppressedTags = 0;
  for (const t of tags) {
    try {
      // resolveTag returns null for suppressed sensitive classes — skip them.
      const nid = await resolveTag(admin, t);
      if (nid) nodeIds.push(nid);
      else suppressedTags++;
    } catch (e) {
      const verdict = classifyFailure(e);
      // Credits / policy / rate limits must stop the task; a single unresolved
      // tag code is not worth failing the whole identifier over.
      if (!verdict.retryable || verdict.kind === "rate_limit") {
        if (verdict.kind === "schema") {
          console.warn("tag resolve schema error", t.code, verdict.reason);
        } else throw e;
      } else console.warn("tag resolve failed", t.code, errMsg(e));
    }
  }
  if (suppressedTags) {
    console.log(
      JSON.stringify({ evt: "suppressed_tags_skipped", count: suppressedTags, report_type: task.report_type }),
    );
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


  // 3. Tag-signature score cache.
  //
  // This is the single biggest cost lever in the whole pipeline. A CTV delivery
  // has ~1.1M identifiers but only a few thousand DISTINCT tag sets (measured:
  // 20k queued rows collapse to 1.1k signatures, ~5%). The semantic score is a
  // pure function of the tag set — two devices that watched the same
  // channel/genre/IAB combination cannot produce different category scores — so
  // calling the AI gateway per identifier burned ~95% of every credit budget on
  // recomputing identical answers, which is what stalled the mapping and
  // dead-lettered the run on `credit_limit_reached`.
  //
  // On a hit we still write this identifier's own rows (audio_source_tags
  // above, source_analyses + intuizi_identifiers below) so the UI and the
  // per-identifier views are byte-for-byte what they'd be after a live call.
  const tagSignature = await tagSignatureOf(task.report_type, tagCodes);
  const { data: cachedRow } = await admin
    .from("intuizi_tag_score_cache")
    .select("scores,descriptions,grounding_level,confidence,hits")
    .eq("tag_signature", tagSignature)
    .maybeSingle();

  let scoreMap = {} as Record<Category, number>;
  let descMap: Record<string, string> = {};
  let groundingLevel = "text-only";
  let fromCache = false;

  if (cachedRow?.scores) {
    fromCache = true;
    scoreMap = { ...(cachedRow.scores as Record<Category, number>) };
    descMap = (cachedRow.descriptions as Record<string, string>) ?? {};
    groundingLevel = cachedRow.grounding_level ?? "text-only";
    // Deliberately NOT re-running calibration, the profile embedding OR the
    // `hits` bump: the prior already learned from this exact tag set on the
    // representative call, and a per-identifier write cost one round trip per
    // row across ~1.1M rows. Hit counts are recorded per batch by
    // `prewarmTagSignatures` instead.
  } else {

    // 3b. Calibration priors + kNN warm start.
    //     `stepScale` < 1 means a previous attempt was killed for compute: keep
    //     the warm start smaller (fewer neighbours, shorter context).
    enter("context");
    let taxonomyContext = await buildTaxonomyContext(admin, nodeIds);
    const neighbourCount = Math.max(1, Math.round(5 * stepScale));
    const queryEmbedding = stepScale >= 0.5
      ? await embed(`intuizi ${task.report_type}; tags: ${tagCodes.join(",")}`)
      : null;
    if (queryEmbedding) {
      const { data: neighbors } = await admin.rpc("match_audio_profiles", {
        query_embedding: queryEmbedding,
        match_count: neighbourCount,
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
    enter("analyze");
    const ana = await invokeAnalyzeAudio(admin, {
      sources: [{
        name: label,
        type: "file",
        audio_source_id: audioSourceId,
        taxonomy_context: taxonomyContext,
      }],
      user_id: ownerId,
      save_results: true,
    }, task.report_type, metrics, { traceId, stepScale });

    const sourceOut = ana.sources[0];
    for (const c of sourceOut.categories ?? []) {
      const key = (c.name ?? "").toLowerCase() as Category;
      scoreMap[key] = Number(c.score) || 0;
      if (c.description) descMap[key] = String(c.description);
    }
    groundingLevel = sourceOut.grounding_level ?? "text-only";

    // 4b. Speech-skew normalization for vocal-heavy Intuizi feeds.
    enter("normalize");
    const normCfg = await loadNormalization(admin, "intuizi");
    const normScores = await applyNormalizationToAnalysis(
      admin,
      audioSourceId!,
      scoreMap,
      normCfg,
    );
    for (const c of CATEGORIES) scoreMap[c] = normScores[c] ?? scoreMap[c];

    // 5. Continuous learning: calibration + profile embedding
    enter("learn");
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

    // 5b. Publish the result for every future identifier with this tag set.
    //     Scores are cached POST-normalization, so a hit reproduces the final
    //     numbers without re-reading the normalization config.
    const { error: cacheErr } = await admin
      .from("intuizi_tag_score_cache")
      .upsert({
        tag_signature: tagSignature,
        report_type: task.report_type,
        tag_codes: tagCodes,
        scores: scoreMap,
        descriptions: descMap,
        grounding_level: groundingLevel,
        confidence: task.confidence ?? 0.5,
        updated_at: new Date().toISOString(),
      }, { onConflict: "tag_signature" });
    // A cache write failure must not fail an identifier that scored fine.
    if (cacheErr) console.warn("tag score cache write failed", cacheErr.message);
  }

  // 5c. On a cache hit nothing wrote `source_analyses` for this source, and the
  //     UI joins identifiers -> audio_sources -> source_analyses. Without this
  //     the identifier looks scored everywhere except the screen the user is
  //     actually looking at.
  if (fromCache) {
    const { error: anaErr } = await admin.from("source_analyses").insert({
      user_id: ownerId,
      audio_source_id: audioSourceId,
      source_name: label,
      confidence: task.confidence ?? 0.5,
      grounding_level: groundingLevel,
      raw_scores: { scores: scoreMap, from_tag_cache: true, tag_signature: tagSignature },
      emotional_score: Math.round(scoreMap.emotional ?? 0),
      cognitive_score: Math.round(scoreMap.cognitive ?? 0),
      social_score: Math.round(scoreMap.social ?? 0),
      communication_score: Math.round(scoreMap.communication ?? 0),
      contextual_score: Math.round(scoreMap.contextual ?? 0),
      artistic_score: Math.round(scoreMap.artistic ?? 0),
      emotional_desc: descMap.emotional ?? null,
      cognitive_desc: descMap.cognitive ?? null,
      social_desc: descMap.social ?? null,
      communication_desc: descMap.communication ?? null,
      contextual_desc: descMap.contextual ?? null,
      artistic_desc: descMap.artistic ?? null,
    });
    if (anaErr) throw anaErr;
  }


  // 6. Idempotent progress marking, in the same step as the work
  enter("persist");
  const mergedCodes = Array.from(new Set([...previousCodes, ...tagCodes]));
  await admin.from("intuizi_identifiers").upsert({
    primary_identifier: task.identifier,
    [signalColumn(task.report_type)]: {
      rows: task.signals,
      confidence: task.confidence,
      scores: scoreMap,
      object_key: task.object_key,
      trace_id: traceId,
      scored_at: new Date().toISOString(),
    },
    tag_codes: mergedCodes,
    audio_source_id: audioSourceId,
    observation_count: (existing?.observation_count ?? 0) + (task.signals?.length ?? 0),
    last_seen_at: new Date().toISOString(),
  }, { onConflict: "primary_identifier" });

  enter("done");
  return {
    status: "scored",
    audio_source_id: audioSourceId,
    scores: scoreMap,
    stage: "done",
    trace_id: traceId,
  };

}

/**
 * Score up to `batchSize` DISTINCT tag signatures in a single `analyze-audio`
 * call, then publish them to `intuizi_tag_score_cache`.
 *
 * Why this exists: the worker used to send ONE identifier per call, which
 * re-transmitted the ~1,300-token system prompt for every row even though the
 * function accepts several sources per request, and even though thousands of
 * identifiers share one tag set. Warming the distinct signatures of a claimed
 * batch up front means every identifier in that batch then takes the cache path
 * (no gateway call, no embedding, no calibration write), cutting LLM spend on
 * the main scoring path by roughly the batch's duplication factor.
 */
// deno-lint-ignore no-explicit-any
export async function prewarmTagSignatures(
  // deno-lint-ignore no-explicit-any
  admin: any,
  tasks: ScoreTask[],
  metrics: RateMetrics = createRateMetrics(),
  opts: { traceId?: string; batchSize?: number; stepScale?: number } = {},
): Promise<{ warmed: number; groups: number; calls: number }> {
  const batchSize = Math.min(Math.max(opts.batchSize ?? 5, 1), 10);
  const traceId = opts.traceId ?? newTraceId();

  // 1. Collapse the batch to distinct tag signatures.
  type Group = {
    signature: string;
    reportType: string;
    tagCodes: string[];
    tags: OntologyTag[];
    confidence: number;
    count: number;
  };
  const groups = new Map<string, Group>();
  for (const task of tasks) {
    const tags = task.tags ?? [];
    const tagCodes = tags.map((t) => t.code);
    if (!tagCodes.length) continue;
    const signature = await tagSignatureOf(task.report_type, tagCodes);
    const existing = groups.get(signature);
    if (existing) existing.count++;
    else {
      groups.set(signature, {
        signature,
        reportType: task.report_type,
        tagCodes,
        tags,
        confidence: task.confidence ?? 0.5,
        count: 1,
      });
    }
  }
  if (!groups.size) return { warmed: 0, groups: 0, calls: 0 };

  // 2. Drop the ones already cached, and record their hit counts in one write
  //    per signature instead of one per identifier.
  const signatures = [...groups.keys()];
  const { data: cached } = await admin
    .from("intuizi_tag_score_cache")
    .select("tag_signature,hits")
    .in("tag_signature", signatures);
  for (const row of cached ?? []) {
    const g = groups.get(row.tag_signature as string);
    if (!g) continue;
    groups.delete(row.tag_signature as string);
    await admin.from("intuizi_tag_score_cache")
      .update({ hits: (row.hits ?? 0) + g.count, updated_at: new Date().toISOString() })
      .eq("tag_signature", row.tag_signature);
  }
  const pending = [...groups.values()];
  if (!pending.length) return { warmed: 0, groups: signatures.length, calls: 0 };

  const normCfg = await loadNormalization(admin, "intuizi");
  let warmed = 0;
  let calls = 0;

  // 3. One gateway call per `batchSize` signatures.
  for (let i = 0; i < pending.length; i += batchSize) {
    const slice = pending.slice(i, i + batchSize);
    const prepared: { group: Group; name: string; nodeIds: string[] }[] = [];

    for (const [idx, group] of slice.entries()) {
      const nodeIds: string[] = [];
      for (const t of group.tags) {
        try {
          const nid = await resolveTag(admin, t);
          if (nid) nodeIds.push(nid);
        } catch (e) {
          const verdict = classifyFailure(e);
          if (!verdict.retryable || verdict.kind === "rate_limit") {
            if (verdict.kind !== "schema") throw e;
          }
          console.warn("prewarm tag resolve failed", t.code, errMsg(e));
        }
      }
      prepared.push({
        group,
        name: `Intuizi pattern ${group.reportType} ${i + idx + 1}`,
        nodeIds,
      });
    }

    const sources = [];
    for (const p of prepared) {
      sources.push({
        name: p.name,
        type: "file",
        taxonomy_context: await buildTaxonomyContext(admin, p.nodeIds),
      });
    }

    calls++;
    const ana = await invokeAnalyzeAudio(
      admin,
      { sources, save_results: false },
      slice[0].group.reportType,
      metrics,
      { traceId, stepScale: opts.stepScale ?? 1 },
    );

    // deno-lint-ignore no-explicit-any
    const byName = new Map<string, any>(
      (ana.sources ?? []).map((s: { name: string }) => [s.name, s]),
    );

    for (const p of prepared) {
      const out = byName.get(p.name);
      if (!out) continue;
      const scoreMap = {} as Record<Category, number>;
      const descMap: Record<string, string> = {};
      for (const c of out.categories ?? []) {
        const key = String(c.name ?? "").toLowerCase() as Category;
        scoreMap[key] = Number(c.score) || 0;
        if (c.description) descMap[key] = String(c.description);
      }
      // Same speech-skew normalization the per-identifier path applies, so a
      // cache hit reproduces the final numbers exactly.
      const normScores = await applyNormalizationToAnalysis(
        admin,
        null,
        scoreMap,
        normCfg,
      );
      for (const c of CATEGORIES) scoreMap[c] = normScores[c] ?? scoreMap[c];

      // Learn once per tag pattern, not once per identifier.
      await updateCalibration(admin, p.nodeIds, scoreMap);

      const { error: cacheErr } = await admin
        .from("intuizi_tag_score_cache")
        .upsert({
          tag_signature: p.group.signature,
          report_type: p.group.reportType,
          tag_codes: p.group.tagCodes,
          scores: scoreMap,
          descriptions: descMap,
          grounding_level: out.grounding_level ?? "text-only",
          confidence: p.group.confidence,
          hits: p.group.count,
          updated_at: new Date().toISOString(),
        }, { onConflict: "tag_signature" });
      if (cacheErr) console.warn("prewarm cache write failed", cacheErr.message);
      else warmed++;
    }
  }

  console.log(JSON.stringify({
    evt: "tag_signature_prewarm",
    trace_id: traceId,
    tasks: tasks.length,
    distinct_signatures: signatures.length,
    warmed,
    gateway_calls: calls,
  }));
  return { warmed, groups: signatures.length, calls };
}
