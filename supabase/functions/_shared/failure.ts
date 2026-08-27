// Shared failure classification + trace identity for the Intuizi pipeline.
//
// Two problems this solves:
//   1. Retry policy. A CPU / timeout kill deserves another attempt with a
//      SMALLER workload, while a schema or contract error will fail identically
//      forever — retrying it just burns budget and hides the real reason.
//   2. Correlation. Ingest, the queue row and every worker invocation now carry
//      the same `trace_id`, so a CPU spike in the logs can be tied back to the
//      exact identifier that caused it.

export type FailureKind =
  | "transient" // network blip / 5xx — plain retry
  | "resource" // CPU, memory or wall-clock kill — retry with smaller steps
  | "rate_limit" // 429 — retry after backoff, pipeline-level parking applies
  | "credits" // 402 — needs the workspace owner, never retry in-run
  | "policy" // 403 — blocked by workspace policy, never retry in-run
  | "auth" // 401 — configuration bug, never retry
  | "schema" // bad column/table/constraint or 400 contract error — fail fast
  | "unknown";

export interface FailureVerdict {
  kind: FailureKind;
  /** Safe to try again automatically? */
  retryable: boolean;
  /** Retrying with the same workload is pointless — shrink it first. */
  shrink: boolean;
  /** Human-readable cause, surfaced to the operator in the queue row. */
  reason: string;
  status?: number;
  /** Suggested wait before the next attempt (ms). 0 when not retryable. */
  backoffMs: number;
}

/** Postgres / PostgREST codes that will never succeed on retry. */
const PERMANENT_PG_CODES = new Set([
  "42703", // undefined column
  "42P01", // undefined table
  "42804", // datatype mismatch
  "22P02", // invalid input syntax
  "23502", // not-null violation
  "23503", // FK violation
  "23514", // check violation
  "PGRST204", // column not found in schema cache
  "PGRST202", // function not found
]);

export function httpStatusOf(e: unknown): number | undefined {
  const s = (e as { status?: number; statusCode?: number })?.status ??
    (e as { statusCode?: number })?.statusCode;
  return typeof s === "number" ? s : undefined;
}

export function messageOf(e: unknown): string {
  if (e instanceof Error) return e.message;
  const m = (e as { message?: string })?.message;
  return m ?? String(e);
}

/** Stage label attached to an error as it bubbles out of scoreIdentifier. */
export function stageOf(e: unknown): string | undefined {
  const s = (e as { stage?: string })?.stage;
  return typeof s === "string" ? s : undefined;
}

export function tagStage<E>(e: E, stage: string): E {
  if (e && typeof e === "object" && !(e as { stage?: string }).stage) {
    (e as { stage?: string }).stage = stage;
  }
  return e;
}

/** Stable, short, sortable trace id shared by ingest, queue rows and workers. */
export function newTraceId(prefix = "itz"): string {
  const t = Date.now().toString(36);
  const r = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${t}_${r}`;
}

export function classifyFailure(e: unknown): FailureVerdict {
  const status = httpStatusOf(e);
  const msg = messageOf(e);
  const code = String((e as { code?: string })?.code ?? "");
  const upper = `${msg} ${code}`.toUpperCase();

  const verdict = (
    kind: FailureKind,
    retryable: boolean,
    shrink: boolean,
    backoffMs: number,
    reason: string,
  ): FailureVerdict => ({ kind, retryable, shrink, backoffMs, reason, status });

  if (status === 402 || /INSUFFICIENTCREDITS|PAYMENT REQUIRED/.test(upper)) {
    return verdict("credits", false, false, 0, `AI credits unavailable: ${msg}`);
  }
  if (status === 403) return verdict("policy", false, false, 0, `Blocked by workspace policy: ${msg}`);
  if (status === 401) return verdict("auth", false, false, 0, `Auth/configuration error: ${msg}`);

  if (
    PERMANENT_PG_CODES.has(code) ||
    /COLUMN .* DOES NOT EXIST|RELATION .* DOES NOT EXIST|SCHEMA CACHE|VIOLATES (NOT-NULL|FOREIGN KEY|CHECK)|INVALID INPUT SYNTAX/
      .test(upper)
  ) {
    return verdict("schema", false, false, 0, `Permanent data/schema error (${code || "pg"}): ${msg}`);
  }
  if (status === 400 || status === 404 || status === 422) {
    return verdict("schema", false, false, 0, `Request rejected (${status}): ${msg}`);
  }

  if (
    status === 546 ||
    /WORKER_RESOURCE_LIMIT|COMPUTE RESOURCES|CPU TIME|MEMORY LIMIT|OUT OF MEMORY|HEAP/.test(upper)
  ) {
    return verdict("resource", true, true, 5_000, `Compute limit hit: ${msg}`);
  }
  if (status === 504 || /IDLE_TIMEOUT|TIMED? ?OUT|DEADLINE|ABORTERROR/.test(upper)) {
    return verdict("resource", true, true, 4_000, `Timed out: ${msg}`);
  }

  if (status === 429 || /RATE ?LIMIT|TOO MANY REQUESTS/.test(upper)) {
    const hinted = Number(msg.match(/"?retryAfterMs"?\s*[:=]\s*(\d+)/)?.[1] ?? 0);
    return verdict("rate_limit", true, false, Math.max(hinted, 15_000), `Rate limited: ${msg}`);
  }

  if ((status ?? 0) >= 500 || /FETCH FAILED|NETWORK|ECONNRESET|SOCKET/.test(upper)) {
    return verdict("transient", true, false, 2_000, `Transient upstream failure: ${msg}`);
  }

  return verdict("unknown", true, true, 3_000, msg);
}

/** Exponential backoff with jitter, floored by the verdict's own hint. */
export function backoffFor(verdict: FailureVerdict, attempt: number): number {
  const base = Math.max(verdict.backoffMs, 500);
  return Math.round(base * 2 ** Math.max(0, attempt - 1) + Math.random() * 400);
}
