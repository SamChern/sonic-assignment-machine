// Background drain for public.intuizi_score_queue.
//
// The Intuizi ingest run stops at "ingest + normalize": it enqueues one scoring
// task per identifier and returns. This worker does the expensive tail (taxonomy
// resolution, analyze-audio, normalization, calibration, embeddings) in small
// claimed batches and then RE-INVOKES ITSELF while work remains. Total pipeline
// time is therefore unbounded, while every single invocation stays far inside the
// wall-clock and CPU limits that previously produced 504 / 546 failures.
//
// Callable by an admin JWT (Intuizi Console / wizard) or a service-role token
// (scheduled tick + self-chaining).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { controlNumber } from "../_shared/control.ts";
import { AuthzError, requireAdmin } from "../_shared/admin.ts";
import {
  createRateMetrics,
  errMsg,
  prewarmTagSignatures,
  scoreIdentifier,
  type ScoreTask,
} from "../_shared/scoreIdentifier.ts";

import {
  backoffFor,
  classifyFailure,
  newTraceId,
  stageOf,
} from "../_shared/failure.ts";


const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/** Wall-clock ceiling per invocation; well under the 150s gateway idle limit. */
const RUN_BUDGET_MS = 60_000;
/** Max identifiers scored concurrently. Dropped to 1 under rate-limit pressure. */
const CONCURRENCY_DEFAULT = 3;
/** Stop claiming when a single task took longer than this share of the budget. */
const SAFETY_MS = 12_000;


function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const startedAt = Date.now();
  const timeLeft = () => RUN_BUDGET_MS - (Date.now() - startedAt);

  try {
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    try {
      await requireAdmin(req, admin);
    } catch (e) {
      if (e instanceof AuthzError) return json({ success: false, error: e.message }, e.status);
      throw e;
    }

    // Control Room knob (60s cached), falls back to the shipped default.
    const batchSize = Math.round(
      await controlNumber(admin, "ingest.score_batch_size", 16, { min: 1, max: 64 }),
    );
    const configuredConcurrency = Math.round(
      await controlNumber(admin, "ingest.score_concurrency", CONCURRENCY_DEFAULT, { min: 1, max: 8 }),
    );


    const reqBody = await req.json().catch(() => ({})) as {
      source?: string;
      trace_id?: string;
      action?: string;
      object_key?: string;
      activation_id?: string;
      include_dead_letter?: boolean;
    };
    /** One id for this invocation; inherited from the caller when chaining. */
    const runTraceId = reqBody.trace_id ?? newTraceId("run");

    // Keep bounded queue cleanup out of the latency-sensitive claim RPC.
    await admin.rpc("retire_exhausted_intuizi_score_jobs", { p_limit: 50 });

    // Operator action: put failed / dead-lettered identifiers back in the queue.
    // Scoring is idempotent per identifier, so already-completed work is skipped
    // instead of redone (a covered tag set short-circuits as `unchanged`).
    if (reqBody.action === "requeue_failed") {
      const { data: rq, error: rqErr } = await admin.rpc(
        "requeue_intuizi_score_failures",
        {
          p_object_key: reqBody.object_key ?? null,
          p_activation_id: reqBody.activation_id ?? null,
          p_include_dead_letter: reqBody.include_dead_letter ?? true,
          p_extra_attempts: 3,
        },
      );
      if (rqErr) return json({ success: false, error: rqErr.message }, 500);
      const row = (Array.isArray(rq) ? rq[0] : rq) as
        | { requeued?: number; remaining_dead_letter?: number }
        | null;
      const requeued = row?.requeued ?? 0;
      if (requeued > 0) {
        admin.functions.invoke("intuizi-score-worker", {
          body: { source: "requeue", trace_id: runTraceId },
        }).catch((e: unknown) => console.warn("kick failed", errMsg(e)));
      }
      console.log(JSON.stringify({
        evt: "intuizi_score_requeue",
        trace_id: runTraceId,
        activation_id: reqBody.activation_id ?? null,
        object_key: reqBody.object_key ?? null,
        requeued,
      }));
      return json({
        success: true,
        action: "requeue_failed",
        trace_id: runTraceId,
        requeued,
        remaining_dead_letter: row?.remaining_dead_letter ?? 0,
      });
    }


    // Never fan out beyond one worker: a paused/parked ingest state means the AI
    // gateway is out of credits or rate limiting, so scoring must wait too.
    const { data: state } = await admin
      .from("intuizi_ingest_state")
      .select("paused,pause_reason,parked_until,consecutive_rate_limits")
      .eq("id", "singleton").maybeSingle();
    if (state?.paused) {
      return json({ success: true, skipped: "paused", reason: state.pause_reason, processed: 0 });
    }
    if (state?.parked_until && new Date(state.parked_until) > new Date()) {
      return json({ success: true, skipped: "parked", processed: 0 });
    }

    const metrics = createRateMetrics();
    let scored = 0;
    let unchanged = 0;
    let failed = 0;
    let paused = false;
    /** Adaptive: starts wide, collapses to 1 as soon as the gateway pushes back. */
    let concurrency = configuredConcurrency;
    let rateLimits = state?.consecutive_rate_limits ?? 0;

    type QueuedTask = ScoreTask & {
      id: string;
      attempts: number;
      max_attempts: number;
      trace_id: string | null;
      step_scale: number | null;
    };

    // Terminal queue states are buffered and flushed once per claimed batch
    // (one `finish_intuizi_score_jobs` call) instead of one UPDATE per
    // identifier: with a batch of 16 that is 1 round trip instead of 16.
    let writes: Record<string, unknown>[] = [];
    const flushWrites = async () => {
      if (!writes.length) return;
      const rows = writes;
      writes = [];
      const { error } = await admin.rpc("finish_intuizi_score_jobs", {
        p_rows: rows,
      });
      if (error) {
        // A lost write means a claimed row keeps its lease and is retried once
        // the lease expires, so it must be loud but not fatal.
        console.error(JSON.stringify({
          evt: "intuizi_score_flush_failed",
          trace_id: runTraceId,
          rows: rows.length,
          error: error.message,
        }));
      }
    };

    /** Scores one identifier and buffers its terminal queue state. */
    const runTask = async (task: QueuedTask) => {
      const t0 = Date.now();
      const traceId = task.trace_id ?? `${runTraceId}.${task.id.slice(0, 8)}`;
      const stepScale = Number(task.step_scale ?? 1) || 1;
      let lastStage = "lookup";
      let outcome = "ok";
      let failureKind: string | null = null;
      try {
        const out = await scoreIdentifier(admin, task, metrics, {
          traceId,
          stepScale,
          onStage: (s) => {
            lastStage = s;
          },
        });
        if (out.status === "scored") scored++;
        else unchanged++;
        writes.push({
          id: task.id,
          status: out.status === "scored" ? "done" : "skipped",
          finished_at: new Date().toISOString(),
          last_stage: out.stage,
          trace_id: traceId,
        });
      } catch (e) {
        failed++;
        const verdict = classifyFailure(e);
        const msg = verdict.reason;
        failureKind = verdict.kind;
        lastStage = stageOf(e) ?? lastStage;
        outcome = "failed";
        const attemptsUsed = task.attempts ?? 1;
        const maxAttempts = task.max_attempts ?? 5;
        // An account-level stop (no credits, workspace policy) says nothing
        // about this identifier — it would score fine tomorrow. Dead-lettering
        // it burned 167 perfectly good rows on one credit limit and required a
        // manual requeue. These rows go back to `pending` with their attempt
        // refunded; the pipeline pause below is what stops the stampede.
        const accountStop = verdict.kind === "credits" || verdict.kind === "policy";
        // Dead-letter (never retried, never silently dropped) when the error is
        // permanent, or when the attempt budget is spent. Everything else is
        // rescheduled with a classified backoff and a smaller workload.
        const dead = !accountStop && (!verdict.retryable || attemptsUsed >= maxAttempts);
        const nextScale = verdict.shrink
          ? Math.max(0.25, stepScale * 0.5)
          : stepScale;
        writes.push({
          id: task.id,
          status: dead ? "dead_letter" : "pending",
          last_error: msg.slice(0, 1000),
          failure_kind: verdict.kind,
          last_stage: lastStage,
          trace_id: traceId,
          step_scale: nextScale,
          // Refund the attempt on an account stop so a long outage can't quietly
          // exhaust the budget of every queued identifier.
          ...(accountStop ? { attempts: Math.max(0, attemptsUsed - 1) } : {}),
          next_attempt_at: new Date(
            Date.now() + (accountStop ? 60_000 : backoffFor(verdict, attemptsUsed)),
          ).toISOString(),
          dead_lettered_at: dead ? new Date().toISOString() : null,
          finished_at: dead ? new Date().toISOString() : null,
        });
        // A pause/park decision below reads its own state, so flush the
        // classified failures first — the run may end right after.
        if (accountStop || verdict.kind === "rate_limit") await flushWrites();


        if (dead) {
          console.error(JSON.stringify({
            evt: "intuizi_score_dead_letter",
            trace_id: traceId,
            identifier: task.identifier,
            object_key: task.object_key,
            stage: lastStage,
            failure_kind: verdict.kind,
            attempts: attemptsUsed,
            reason: msg.slice(0, 400),
          }));
        }

        // Credit / policy / sustained rate-limit failures pause the pipeline
        // instead of burning every remaining queue item on the same error.
        if (verdict.kind === "credits" || verdict.kind === "policy") {
          paused = true;
          await admin.from("intuizi_ingest_state").update({
            paused: true,
            pause_reason: msg.slice(0, 500),
            paused_at: new Date().toISOString(),
          }).eq("id", "singleton");
        } else if (verdict.kind === "rate_limit") {
          // Back off hard: serialize the remaining work for this invocation.
          concurrency = 1;
          rateLimits += 1;
          const next = rateLimits;
          await admin.from("intuizi_ingest_state").update({
            consecutive_rate_limits: next,
            last_error: msg.slice(0, 500),
            ...(next >= 3
              ? { parked_until: new Date(Date.now() + 30 * 60 * 1000).toISOString() }
              : {}),
          }).eq("id", "singleton");
          if (next >= 3) paused = true;
          else await new Promise((r) => setTimeout(r, 2000 * next));
        }
      }
      console.log(JSON.stringify({
        evt: "intuizi_score_task",
        trace_id: traceId,
        queue_id: task.id,
        identifier: task.identifier,
        object_key: task.object_key,
        report_type: task.report_type,
        activation_id: (task as { activation_id?: string }).activation_id ?? null,
        attempt: task.attempts ?? 1,
        step_scale: stepScale,
        stage: lastStage,
        outcome,
        failure_kind: failureKind,
        duration_ms: Date.now() - t0,
        time_remaining_ms: timeLeft(),
      }));
    };

    // Optional operator focus: drain ONE activation end to end instead of the
    // global oldest-first backlog (a six-figure older queue would otherwise
    // starve a freshly ingested activation for days).
    const focusActivation = reqBody.activation_id ?? null;

    // Cheap pass first: every queued identifier whose tag set was ALREADY
    // scored is a pure database write (no AI, no embedding, no kNN). Draining
    // those in bulk before touching the gateway is what makes a six-figure
    // activation finishable — measured ~800 identifiers/second versus ~3 per
    // minute through the AI path. The AI loop below then only pays for tag
    // sets nobody has seen yet, and each new signature it learns unlocks
    // thousands more rows for the next bulk pass.
    let materialized = 0;
    const materializePass = async () => {
      // No focus activation means the whole backlog: cached tag patterns are
      // drained globally (oldest first) before any credit is spent.

      while (timeLeft() > SAFETY_MS && !paused) {
        const { data, error } = await admin.rpc(
          "materialize_cached_intuizi_scores",
          { p_activation_id: focusActivation, p_limit: 250 },
        );
        if (error) {
          console.warn("materialize pass failed", error.message);
          return;
        }
        const row = (Array.isArray(data) ? data[0] : data) as
          | { materialized?: number }
          | null;
        const n = row?.materialized ?? 0;
        materialized += n;
        if (n === 0) return;
      }
    };
    await materializePass();

    while (timeLeft() > SAFETY_MS && !paused) {

      const { data: claimed, error: claimErr } = await admin.rpc(
        "claim_intuizi_score_jobs",
        {
          p_limit: concurrency === 1 ? 1 : batchSize,
          p_activation_id: focusActivation,
        },
      );
      if (claimErr) return json({ success: false, error: claimErr.message }, 500);

      const tasks = (claimed ?? []) as QueuedTask[];
      if (!tasks.length) break;

      // Warm every DISTINCT tag pattern in this batch with a single
      // multi-source analyze-audio call each (up to 5 patterns per call), then
      // let the identifiers take the cache path. This is the difference between
      // one gateway call per identifier and one per ~5 distinct patterns.
      try {
        await prewarmTagSignatures(admin, tasks, metrics, {
          traceId: runTraceId,
          batchSize: 5,
        });
      } catch (e) {
        const verdict = classifyFailure(e);
        console.warn("tag prewarm failed, falling back per identifier", verdict.reason);
        if (verdict.kind === "credits" || verdict.kind === "policy") paused = true;
      }

      // Bounded parallelism: `concurrency` identifiers in flight at once. Each
      // task is independent (own row, own idempotency check), so a slow AI
      // gateway round-trip no longer blocks the whole batch.

      let cursor = 0;
      const lanes = Array.from(
        { length: Math.max(1, Math.min(concurrency, tasks.length)) },
        async () => {
          while (cursor < tasks.length && !paused && timeLeft() > SAFETY_MS) {
            const task = tasks[cursor++];
            if (!task) break;
            await runTask(task);
          }
        },
      );
      await Promise.all(lanes);
      // One write for the whole batch's outcomes.
      await flushWrites();
    }
    await flushWrites();

    // Keep the activation's enterprise summary (the homepage "synced enterprise
    // analyses" card) in step with what has actually been scored.
    if (focusActivation) {
      const { error: refreshErr } = await admin.rpc(
        "refresh_intuizi_activation_dataset",
        { p_activation_id: focusActivation },
      );
      if (refreshErr) console.warn("dataset refresh failed", refreshErr.message);
    }




    // How much work is left, and should another invocation pick it up?
    // Exact counts over a six-figure backlog blow past the database statement
    // timeout, so the depth is measured against a cap: all we need to decide is
    // "is there more work", and the reported number is a capped indicator.
    let pending = 0;
    let deadLetter = 0;
    let depthCap = 5000;
    if (focusActivation) {
      // Bounded probe scoped to the focused activation only.
      const { count } = await admin
        .from("intuizi_score_queue")
        .select("id", { count: "exact", head: true })
        .eq("activation_id", focusActivation)
        .eq("status", "pending")
        .limit(1000);
      pending = count ?? 0;
    } else {
      const { data: depthRows } = await admin.rpc("intuizi_score_queue_depth", {
        p_cap: 5000,
      });
      const depth = (Array.isArray(depthRows) ? depthRows[0] : depthRows) as
        | { pending_capped?: number; dead_letter_capped?: number; capped_at?: number }
        | null;
      pending = depth?.pending_capped ?? 0;
      deadLetter = depth?.dead_letter_capped ?? 0;
      depthCap = depth?.capped_at ?? 5000;
    }

    const remaining = pending ?? 0;

    const willChain = remaining > 0 && !paused;
    if (willChain) {
      // Self-chaining: fire and forget, so this response returns immediately.
      admin.functions.invoke("intuizi-score-worker", {
        body: {
          source: "chain",
          trace_id: runTraceId,
          ...(focusActivation ? { activation_id: focusActivation } : {}),
        },
      }).catch((e: unknown) => console.warn("chain failed", errMsg(e)));
    }


    const body = {
      success: true,
      trace_id: runTraceId,
      scored,
      materialized,
      unchanged,
      failed,

      paused,
      pending: remaining,
      pending_capped_at: depthCap,
      dead_letter: deadLetter ?? 0,

      chained: willChain,
      elapsed_ms: Date.now() - startedAt,
      ...metrics.snapshot(),
    };
    console.log(JSON.stringify({ evt: "intuizi_score_worker_run", ...body }));
    return json(body);

  } catch (e) {
    console.error("intuizi-score-worker failed", e);
    return json({ success: false, error: errMsg(e) }, 500);
  }
});
