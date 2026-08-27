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
import { AuthzError, requireAdmin } from "../_shared/admin.ts";
import {
  createRateMetrics,
  errMsg,
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
/** Tasks claimed per batch. Small batches keep peak memory flat. */
const BATCH = 3;
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

    while (timeLeft() > SAFETY_MS && !paused) {
      const { data: claimed, error: claimErr } = await admin.rpc(
        "claim_intuizi_score_jobs",
        { p_limit: BATCH },
      );
      if (claimErr) return json({ success: false, error: claimErr.message }, 500);
      const tasks = (claimed ?? []) as Array<
        ScoreTask & {
          id: string;
          attempts: number;
          max_attempts: number;
          trace_id: string | null;
          step_scale: number | null;
        }
      >;
      if (!tasks.length) break;

      // Strictly sequential: one AI gateway request in flight at a time.
      for (const task of tasks) {
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
          await admin.from("intuizi_score_queue").update({
            status: out.status === "scored" ? "done" : "skipped",
            finished_at: new Date().toISOString(),
            last_error: null,
            failure_kind: null,
            last_stage: out.stage,
            trace_id: traceId,
          }).eq("id", task.id);
        } catch (e) {
          failed++;
          const verdict = classifyFailure(e);
          const msg = verdict.reason;
          failureKind = verdict.kind;
          lastStage = stageOf(e) ?? lastStage;
          outcome = "failed";
          const attemptsUsed = task.attempts ?? 1;
          const maxAttempts = task.max_attempts ?? 5;
          // Dead-letter (never retried, never silently dropped) when the error is
          // permanent, or when the attempt budget is spent. Everything else is
          // rescheduled with a classified backoff and a smaller workload.
          const dead = !verdict.retryable || attemptsUsed >= maxAttempts;
          const nextScale = verdict.shrink
            ? Math.max(0.25, stepScale * 0.5)
            : stepScale;
          await admin.from("intuizi_score_queue").update({
            status: dead ? "dead_letter" : "pending",
            last_error: msg.slice(0, 1000),
            failure_kind: verdict.kind,
            last_stage: lastStage,
            trace_id: traceId,
            step_scale: nextScale,
            next_attempt_at: new Date(
              Date.now() + backoffFor(verdict, attemptsUsed),
            ).toISOString(),
            dead_lettered_at: dead ? new Date().toISOString() : null,
            finished_at: dead ? new Date().toISOString() : null,
          }).eq("id", task.id);

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
            const next = (state?.consecutive_rate_limits ?? 0) + 1;
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
        if (timeLeft() <= SAFETY_MS || paused) break;
      }

    }

    // How much work is left, and should another invocation pick it up?
    const { count: pending } = await admin
      .from("intuizi_score_queue")
      .select("id", { count: "exact", head: true })
      .in("status", ["pending", "processing"]);
    const { count: deadLetter } = await admin
      .from("intuizi_score_queue")
      .select("id", { count: "exact", head: true })
      .eq("status", "dead_letter");

    const remaining = pending ?? 0;
    const willChain = remaining > 0 && !paused;
    if (willChain) {
      // Self-chaining: fire and forget, so this response returns immediately.
      admin.functions.invoke("intuizi-score-worker", {
        body: { source: "chain", trace_id: runTraceId },
      }).catch((e: unknown) => console.warn("chain failed", errMsg(e)));
    }

    const body = {
      success: true,
      trace_id: runTraceId,
      scored,
      unchanged,
      failed,
      paused,
      pending: remaining,
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
