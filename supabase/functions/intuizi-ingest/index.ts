// Intuizi ingest CONTROL PLANE (Step 2.5).
//
// This function used to decode Parquet and score identifiers inside the edge
// runtime. Both are unbounded CPU work against a bounded worker, which is why
// large deliveries reliably died with WORKER_RESOURCE_LIMIT (546) or
// IDLE_TIMEOUT (504) no matter how small the caps got.
//
// It is now a control plane and does only bounded metadata work:
//  1. Read the paused/parked state — exit while paused (one probe dispatch
//     allowed after a credit/policy pause, to detect out-of-band recovery).
//  2. Acquire the DB lease — a second concurrent run exits instead of racing.
//  3. List a bounded number of unprocessed objects under each report prefix.
//  4. Write/advance the ledger row and DISPATCH one SQS message per file.
//  5. Return. The DuckDB worker on EC2 (deploy/ingest-worker) decodes the file,
//     normalizes rows and reports back through `ingest-worker-callback`, which
//     enqueues scoring tasks exactly as before.
//
// Ledger status machine:
//   discovered -> enqueued -> processing -> done | partial | failed
//   ('partial' is re-dispatched from its saved row-group/row cursor.)
//
// Audio objects still run inline: that path is one Librosa HTTP call, not a
// decode loop, so it was never the source of the compute kills.
//
// Callable by an admin JWT (manual run from Intuizi Console) or a
// service-role bearer token (the scheduled pg_cron trigger).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { newTraceId } from "../_shared/failure.ts";

import {
  activationIdFromKey,
  ingestPrefixes,
  isAudioKey,
  partitionDateFromKey,
  REPORT_TYPES,
  type ReportType,
  reportTypeFromKey,
} from "../_shared/intuizi.ts";
import {
  attachProfileEmbedding,
  callUpstream,
  getUpstreamCreds,
} from "../_shared/librosa.ts";

import {
  queueAttributes,
  sendIngestMessage,
  sqsConfigured,
  sqsInfo,
} from "../_shared/sqs.ts";

import { headObject, listObjects, s3BackendInfo, s3Configured, signReadUrl } from "../_shared/s3.ts";
import { requireAdmin, AuthzError } from "../_shared/admin.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// ---- Work bounds (every run ends, even with work remaining) ----------------
// Dispatch is metadata-only: a List, a ledger upsert and one SQS SendMessage per
// file. That is milliseconds of CPU, so a run can safely hand off many files
// where the old decode-in-edge design could barely finish one.
const MAX_FILES_PER_RUN = Number(Deno.env.get("INTUIZI_MAX_FILES_PER_RUN") ?? "25");
/** Cap the worker's per-message slice so one file still checkpoints & resumes. */
const MAX_ROWS_PER_MESSAGE = Number(Deno.env.get("INTUIZI_MAX_ROWS_PER_MESSAGE") ?? "250000");
/** How long a claimed file may go without a heartbeat before it is re-dispatched. */
const STALE_CLAIM_MS = Number(Deno.env.get("INTUIZI_STALE_CLAIM_MS") ?? String(15 * 60 * 1000));
// The edge gateway kills a request after 150s of idle time. Dispatch is fast, so
// a short budget is plenty and keeps the run comfortably inside every limit.
const RUN_BUDGET_MS = 30_000;
/** Floor/ceiling for the auto-tuned wall-clock budget. */
const MIN_RUN_BUDGET_MS = 15_000;
const MAX_RUN_BUDGET_MS = 45_000;


/** Heap ceiling (MB) that counts as compute pressure and ends the run early. */
const MEM_SOFT_LIMIT_MB = Number(Deno.env.get("INTUIZI_MEM_SOFT_LIMIT_MB") ?? "220");
/** Absolute floors so a shrinking cap still makes forward progress. */
const MIN_ROWS_PER_MESSAGE = 25_000;
const MIN_FILES_PER_RUN = 1;

/** One historical run, kept in intuizi_ingest_state.last_run_summary. */
export interface BudgetHistoryEntry {
  at: string;
  budget_ms: number;
  elapsed_ms: number;
  timed_out: boolean;
  /** Set when the caller reported a WORKER_RESOURCE_LIMIT kill for the last run. */
  resource_kill?: boolean;
  /** Peak heap seen during the run (MB), when the runtime exposes it. */
  mem_peak_mb?: number;
  /** Row-slice cap this run actually dispatched, so the tuner can keep shrinking. */
  rows_cap?: number;
}

/**
 * Per-invocation dispatch caps.
 *
 * Since Step 2.5 these bound *dispatch*, not decoding:
 *  - `rows`  — the row slice one SQS message asks the EC2 worker to process
 *              before it checkpoints and re-queues the remainder;
 *  - `files` — how many files this run hands off.
 *
 * The edge side no longer decodes anything, so a 546 here is close to
 * impossible — but the tuner is kept because the DuckDB worker reports its own
 * pressure back through the callback, and shrinking the slice is exactly the
 * right response to a worker that is running out of memory on wide row groups.
 */
export interface WorkCaps {
  rows: number;
  files: number;
  reason: string;
  shrink: number;
}

export function planWorkCaps(
  history: BudgetHistoryEntry[],
  opts: {
    shrink?: number;
    afterResourceLimit?: boolean;
    maxRows?: number;
    maxFiles?: number;
    memPeakMb?: number | null;
  } = {},
): WorkCaps {
  const recent = history.slice(-3);
  const kills = recent.filter((r) => r.resource_kill).length +
    (opts.afterResourceLimit ? 1 : 0);
  const overruns = recent.filter((r) => r.timed_out).length;
  const memPressure = recent.some((r) => (r.mem_peak_mb ?? 0) >= MEM_SOFT_LIMIT_MB) ||
    (opts.memPeakMb ?? 0) >= MEM_SOFT_LIMIT_MB;

  let shrink = 1;
  const why: string[] = [];
  if (kills) {
    shrink *= Math.max(0.2, 0.5 ** kills);
    why.push(`${kills} recent compute kill${kills === 1 ? "" : "s"}`);
  }
  if (overruns) {
    shrink *= Math.max(0.5, 1 - 0.2 * overruns);
    why.push(`${overruns} recent budget overrun${overruns === 1 ? "" : "s"}`);
  }
  if (memPressure) {
    shrink *= 0.6;
    why.push(`heap peaked at or above ${MEM_SOFT_LIMIT_MB} MB`);
  }
  if (opts.shrink && opts.shrink > 0 && opts.shrink < 1) {
    shrink *= opts.shrink;
    why.push(`caller requested ${Math.round(opts.shrink * 100)}% workload`);
  }
  shrink = Math.max(0.1, Math.min(1, shrink));

  let rows = Math.max(
    MIN_ROWS_PER_MESSAGE,
    Math.round((MAX_ROWS_PER_MESSAGE * shrink) / 1000) * 1000,
  );
  let files = Math.max(MIN_FILES_PER_RUN, Math.round(MAX_FILES_PER_RUN * shrink));
  if (opts.maxRows && opts.maxRows > 0) {
    rows = Math.min(rows, Math.max(MIN_ROWS_PER_MESSAGE, opts.maxRows));
  }
  if (opts.maxFiles && opts.maxFiles > 0) files = Math.min(files, Math.max(1, opts.maxFiles));

  return {
    rows,
    files,
    shrink: Number(shrink.toFixed(2)),
    reason: why.length ? why.join("; ") : "defaults — no compute pressure detected",
  };
}

/** Heap/RSS snapshot in MB, or null when the runtime hides memory usage. */
export function memSnapshot(): { heap_mb: number; rss_mb: number; external_mb: number } | null {
  try {
    const m = Deno.memoryUsage();
    const mb = (n: number) => Number((n / 1048576).toFixed(1));
    return { heap_mb: mb(m.heapUsed), rss_mb: mb(m.rss), external_mb: mb(m.external) };
  } catch {
    return null;
  }
}

// Since Step 2.5 the control plane only discovers, dispatches and persists —
// `read`/`normalize`/`score` now happen on the EC2 worker and are reported back
// through `ingest-worker-callback`.
export type PhaseName = "discover" | "dispatch" | "persist" | "audio";

/**
 * Records wall/CPU-ish duration plus heap growth for each pipeline phase, so a
 * compute kill can be attributed to the exact step (and row group) that caused it.
 */
export function createPhaseMeter() {
  const phases: Record<string, {
    ms: number;
    calls: number;
    heap_delta_mb: number;
    heap_after_mb: number | null;
    peak_heap_mb: number;
  }> = {};
  let peakHeap = 0;
  let peakRss = 0;

  return {
    /** Call at the START of a phase; returns a closer that records the phase. */
    begin(phase: PhaseName) {
      const before = memSnapshot();
      const t0 = Date.now();
      return (extra?: Record<string, unknown>) => {
        const after = memSnapshot();
        const ms = Date.now() - t0;
        const slot = phases[phase] ??= {
          ms: 0, calls: 0, heap_delta_mb: 0, heap_after_mb: null, peak_heap_mb: 0,
        };
        slot.ms += ms;
        slot.calls++;
        if (before && after) {
          slot.heap_delta_mb = Number((slot.heap_delta_mb + (after.heap_mb - before.heap_mb)).toFixed(1));
          slot.heap_after_mb = after.heap_mb;
          slot.peak_heap_mb = Math.max(slot.peak_heap_mb, after.heap_mb);
          peakHeap = Math.max(peakHeap, after.heap_mb, before.heap_mb);
          peakRss = Math.max(peakRss, after.rss_mb, before.rss_mb);
        }
        console.log(JSON.stringify({
          evt: "ingest_phase_usage",
          phase,
          ms,
          heap_before_mb: before?.heap_mb ?? null,
          heap_after_mb: after?.heap_mb ?? null,
          heap_delta_mb: before && after ? Number((after.heap_mb - before.heap_mb).toFixed(1)) : null,
          rss_mb: after?.rss_mb ?? null,
          external_mb: after?.external_mb ?? null,
          ...(extra ?? {}),
        }));
        return ms;
      };
    },
    /** True once the heap crosses the soft limit — the run should checkpoint. */
    underPressure() {
      const now = memSnapshot();
      if (!now) return false;
      peakHeap = Math.max(peakHeap, now.heap_mb);
      peakRss = Math.max(peakRss, now.rss_mb);
      return now.heap_mb >= MEM_SOFT_LIMIT_MB;
    },
    peakHeapMb: () => (peakHeap > 0 ? peakHeap : null),
    peakRssMb: () => (peakRss > 0 ? peakRss : null),
    snapshot: () => JSON.parse(JSON.stringify(phases)) as typeof phases,
  };
}


/**
 * Choose this run's wall-clock budget from recent history.
 *
 * A run that burned its whole budget and still had to checkpoint means the last
 * read overran — shrink the budget so the next resume leaves more headroom
 * before the gateway's 150s idle limit. Runs that finished comfortably inside
 * the budget grow it back toward the ceiling.
 */
export function tuneRunBudget(
  history: BudgetHistoryEntry[],
  fallback = MAX_RUN_BUDGET_MS,
): { budgetMs: number; reason: string } {
  const recent = history.slice(-5);
  if (!recent.length) return { budgetMs: fallback, reason: "no history" };

  const last = recent[recent.length - 1];
  const overruns = recent.filter((r) => r.timed_out).length;
  const clamp = (n: number) =>
    Math.max(MIN_RUN_BUDGET_MS, Math.min(MAX_RUN_BUDGET_MS, Math.round(n / 1000) * 1000));

  if (last.timed_out) {
    const shrink = 1 - Math.min(0.4, 0.15 * overruns);
    return {
      budgetMs: clamp((last.budget_ms || fallback) * shrink),
      reason: `last run exhausted its budget (${overruns} of ${recent.length} recent runs)`,
    };
  }

  const worst = Math.max(...recent.map((r) => r.elapsed_ms || 0));
  if (worst > 0 && worst < (last.budget_ms || fallback) * 0.6) {
    return {
      budgetMs: clamp(Math.max(last.budget_ms || fallback, worst * 1.8)),
      reason: `recent runs finished in ${Math.round(worst / 1000)}s — growing budget`,
    };
  }
  return { budgetMs: clamp(last.budget_ms || fallback), reason: "holding steady" };
}

const LEASE_SECONDS = 600;

type Json = Record<string, unknown>;

const SIGNAL_COLUMN: Record<ReportType, string> = {
  ctv: "ctv_signals",
  apps: "apps_signals",
  visitation: "visitation_signals",
  demographics: "demographics_signals",
  origin: "origin_signals",
};

// ---- Manual-key ingest helpers ---------------------------------------------

/** Accept a bare key, an `s3://bucket/key` URI, or an https console URL. */
function normalizeKeyInput(raw: string): string {
  let v = raw.trim().replace(/^["'<]|["'>]$/g, "");
  if (!v) return "";
  if (v.startsWith("s3://")) v = v.slice(5).split("/").slice(1).join("/");
  else if (/^https?:\/\//i.test(v)) {
    try {
      const u = new URL(v);
      // console links look like /s3/object/<bucket>?prefix=<key>
      const prefix = u.searchParams.get("prefix");
      v = prefix ?? u.pathname.replace(/^\//, "").split("/").slice(1).join("/");
      v = decodeURIComponent(v);
    } catch { /* fall through with raw value */ }
  }
  return v.replace(/^\/+/, "");
}

function isManifestKey(key: string): boolean {
  return /(manifest|_keys|filelist)[^/]*\.(json|txt|csv)$/i.test(key);
}

/** Read a manifest object and pull out the S3 keys it lists. */
async function readManifestKeys(key: string): Promise<string[]> {
  const url = await signReadUrl(key);
  // Bounded: a slow S3 response must not eat the whole dispatch budget.
  const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`manifest read failed [${res.status}]`);
  const text = await res.text();
  const out: string[] = [];
  const trimmed = text.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    const walk = (v: unknown) => {
      if (typeof v === "string") {
        const k = normalizeKeyInput(v);
        if (k && /\.[a-z0-9]{2,8}$/i.test(k)) out.push(k);
      } else if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === "object") Object.values(v).forEach(walk);
    };
    walk(JSON.parse(trimmed));
  } else {
    for (const line of trimmed.split(/\r?\n/)) {
      for (const cell of line.split(",")) {
        const k = normalizeKeyInput(cell);
        if (k && /\.[a-z0-9]{2,8}$/i.test(k)) out.push(k);
      }
    }
  }
  return Array.from(new Set(out));
}


function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function statusOf(e: unknown): number | undefined {
  const s = (e as { status?: number })?.status;
  if (s) return s;
  const msg = errMsg(e);
  const m = msg.match(/gateway (\d{3})|\[(\d{3})\]/);
  return m ? Number(m[1] ?? m[2]) : undefined;
}

/** Readable message for Errors, PostgrestErrors and FunctionsHttpError bodies. */
function errMsg(e: unknown): string {
  if (e instanceof Error) {
    // deno-lint-ignore no-explicit-any
    const ctx = (e as any).context;
    const extra = ctx && typeof ctx === "object"
      ? ` :: ${JSON.stringify(ctx).slice(0, 400)}`
      : "";
    return `${e.message}${extra}`;
  }
  if (e && typeof e === "object") {
    // deno-lint-ignore no-explicit-any
    const o = e as any;
    const parts = [o.message, o.details, o.hint, o.code].filter(Boolean);
    return parts.length ? parts.join(" | ") : JSON.stringify(o).slice(0, 600);
  }
  return String(e);
}

/**
 * Ingest one audio object from S3.
 *
 * 1. Register (or reuse) an `audio_sources` row keyed on the object key.
 * 2. Measure acoustics on the Librosa service using a short-lived signed URL —
 *    the bytes never pass through this function.
 * 3. Cache `librosa_features` + profile embedding, then score through
 *    `analyze-audio` (which reads the cached features as its evidence tier).
 */
// deno-lint-disable-next-line no-explicit-any
async function ingestAudioObject(admin: any, args: {
  key: string;
  ownerId: string;
  probeOnly: boolean;
}) {
  const { key, ownerId, probeOnly } = args;
  const name = key.split("/").pop() || key;

  const { data: existing } = await admin
    .from("audio_sources")
    .select("id,librosa_features")
    .eq("user_id", ownerId)
    .eq("source_type", "s3_audio")
    .contains("ctv_metadata", { object_key: key })
    .maybeSingle();

  let audioSourceId: string | null = existing?.id ?? null;
  if (!audioSourceId) {
    const { data: src, error: srcErr } = await admin
      .from("audio_sources")
      .insert({
        user_id: ownerId,
        source_type: "s3_audio",
        name,
        ctv_metadata: { provider: "s3", object_key: key, ingested_at: new Date().toISOString() },
      })
      .select("id").single();
    if (srcErr) throw srcErr;
    audioSourceId = src.id;
  }

  // A probe run only registers the file; it does no paid downstream work.
  if (probeOnly) return audioSourceId;

  let features: Record<string, unknown> | null = existing?.librosa_features ?? null;
  if (!features) {
    const creds = await getUpstreamCreds(admin);
    if (!creds) throw new Error("Librosa REST credentials are not configured");
    const audioUrl = await signReadUrl(key);
    const up = await callUpstream(creds, "/analyze_full", {
      audio_url: audioUrl,
      identity: key,
    });
    if (!up.ok) {
      throw Object.assign(new Error(up.error ?? "librosa upstream failed"), {
        status: up.status,
      });
    }
    features = (up.parsed?.features ?? up.parsed ?? null) as Record<string, unknown> | null;
    if (features) {
      await admin.from("audio_sources")
        .update({ librosa_features: features })
        .eq("id", audioSourceId);
      await attachProfileEmbedding(admin, {
        cacheKey: null,
        audioSourceId,
        userId: ownerId,
        features,
      });
    }
  }

  await invokeAnalyzeAudio(admin, {
    sources: [{ name, type: "file", audio_source_id: audioSourceId }],
    user_id: ownerId,
    save_results: true,
  });


  return audioSourceId;
}

/**
 * Rate-limit telemetry for one invocation. Emitted as a single structured JSON
 * log line per file and per run so an activation failure can be diagnosed
 * without replaying the ingest.
 */
const rateMetrics = {
  attempts: 0,
  retries: 0,
  terminal: 0,
  rateLimited: 0,
  byReport: {} as Record<string, number>,
  retryAfterMs: [] as number[],
  reset() {
    this.attempts = 0;
    this.retries = 0;
    this.terminal = 0;
    this.rateLimited = 0;
    this.byReport = {};
    this.retryAfterMs = [];
  },
  /** Percentile summary of the observed `retryAfterMs` hints. */
  retryAfterSummary() {
    const v = [...this.retryAfterMs].sort((a, b) => a - b);
    if (!v.length) return null;
    const at = (p: number) => v[Math.min(v.length - 1, Math.floor(p * v.length))];
    return {
      n: v.length,
      min: v[0],
      p50: at(0.5),
      p95: at(0.95),
      max: v[v.length - 1],
      mean: Math.round(v.reduce((a, b) => a + b, 0) / v.length),
    };
  },
  snapshot() {
    return {
      analyze_attempts: this.attempts,
      analyze_retries: this.retries,
      rate_limited_calls: this.rateLimited,
      terminal_errors: this.terminal,
      rate_limits_by_report_type: this.byReport,
      retry_after_ms: this.retryAfterSummary(),
    };
  },
};

/**
 * Invoke `analyze-audio` with bounded backoff. The AI gateway rate-limits the
 * whole workspace (`429` / `RateLimitError` with `retryAfterMs`), which used to
 * land rows in `failed_rows` even though the taxonomy mapped fine. Retryable:
 * 429 + 5xx. Terminal: 400/401/402/403 — re-sending returns the same error.
 */
// deno-lint-ignore no-explicit-any
async function invokeAnalyzeAudio(
  // deno-lint-ignore no-explicit-any
  admin: any,
  body: Json,
  reportType = "unknown",
  // deno-lint-ignore no-explicit-any
): Promise<any> {
  const MAX_ATTEMPTS = 4;
  let lastErr: unknown = null;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    rateMetrics.attempts++;
    const { data, error } = await admin.functions.invoke("analyze-audio", { body });
    if (!error) {
      if (!data?.sources?.[0]) throw new Error("analyze-audio returned no source");
      return data;
    }
    lastErr = error;
    const msg = String(error?.message ?? error);
    const status = Number((error as { status?: number })?.status ?? 0);
    const terminal = [400, 401, 402, 403].includes(status) ||
      /InsufficientCredits|PaymentRequired|Forbidden|Unauthorized/i.test(msg);
    const isRateLimit = !terminal && (status === 429 || /RateLimit|rate limit/i.test(msg));
    const retryable = !terminal &&
      (isRateLimit || status >= 500 || /timeout|503|502/i.test(msg));
    if (isRateLimit) {
      rateMetrics.rateLimited++;
      rateMetrics.byReport[reportType] = (rateMetrics.byReport[reportType] ?? 0) + 1;
    }
    if (terminal) rateMetrics.terminal++;
    const hinted = Number(msg.match(/"retryAfterMs"\s*:\s*(\d+)/)?.[1] ?? 0);
    if (hinted > 0) rateMetrics.retryAfterMs.push(hinted);
    if (!retryable || attempt === MAX_ATTEMPTS) {
      console.log(JSON.stringify({
        evt: "analyze_audio_giving_up",
        report_type: reportType,
        attempt,
        status,
        terminal,
        rate_limited: isRateLimit,
        retry_after_ms: hinted || null,
        message: msg.slice(0, 300),
      }));
      break;
    }
    const backoff = Math.max(hinted, 400 * 2 ** (attempt - 1));
    const jitter = Math.floor(Math.random() * 250);
    rateMetrics.retries++;
    console.log(JSON.stringify({
      evt: "analyze_audio_retry",
      report_type: reportType,
      attempt,
      max_attempts: MAX_ATTEMPTS,
      status,
      rate_limited: isRateLimit,
      retry_after_ms: hinted || null,
      wait_ms: backoff + jitter,
      message: msg.slice(0, 200),
    }));
    await new Promise((r) => setTimeout(r, backoff + jitter));
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}



Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const admin = createClient(SUPABASE_URL, SERVICE_KEY);
  // Uniform authorization: admin role or internal service-role (scheduled) run.
  const authz = await requireAdmin(req, admin).catch((e) => e as AuthzError);
  if (authz instanceof AuthzError) return json({ error: authz.message }, authz.status);
  const isCron = authz.isInternal;
  const actorId: string | null = authz.userId;

  let body: Json = {};
  try { body = await req.json(); } catch { /* empty body = scheduled run */ }
  const action = String(body.action ?? "run");

  const { data: state } = await admin
    .from("intuizi_ingest_state").select("*").eq("id", "singleton").maybeSingle();

  // ---- Owner controls -----------------------------------------------------
  if (action === "status") {
    return json({
      state,
      s3_configured: s3Configured(),
      s3: s3BackendInfo(),
      // Control-plane mode: dispatch only works once the queue is configured.
      dispatch: sqsInfo(),
    });
  }

  // ---- Control-plane queue health -----------------------------------------
  // Depth of the file queue plus the ledger's view of in-flight work, so the
  // admin can tell "nothing dispatched" apart from "worker is not draining".
  if (action === "queue_status") {
    const [{ data: pending }, { data: inflight }, { data: stalled }] = await Promise.all([
      admin.from("intuizi_ingest_files")
        .select("object_key,report_type,enqueued_at,dispatch_attempts")
        .in("status", ["discovered", "partial"]).order("discovered_at").limit(50),
      admin.from("intuizi_ingest_files")
        .select("object_key,report_type,status,enqueued_at,heartbeat_at,worker_id,processed_rows,total_rows")
        .in("status", ["enqueued", "processing"]).order("enqueued_at").limit(50),
      admin.from("intuizi_ingest_files")
        .select("object_key,status,heartbeat_at,worker_id")
        .in("status", ["enqueued", "processing"])
        .lt("heartbeat_at", new Date(Date.now() - STALE_CLAIM_MS).toISOString())
        .limit(50),
    ]);

    let queue: Awaited<ReturnType<typeof queueAttributes>> | null = null;
    let queueError: string | null = null;
    if (sqsConfigured()) {
      try {
        queue = await queueAttributes();
      } catch (e) {
        queueError = errMsg(e).slice(0, 400);
      }
    }

    return json({
      dispatch: sqsInfo(),
      queue,
      queue_error: queueError,
      awaiting_dispatch: pending ?? [],
      in_flight: inflight ?? [],
      stalled: stalled ?? [],
      stale_claim_ms: STALE_CLAIM_MS,
    });
  }

  // ---- Access probe --------------------------------------------------------
  // Reports, per configured prefix, whether s3:ListBucket currently works, so
  // the admin knows whether auto-discovery or the manual key path is in play.
  if (action === "probe_access") {
    if (!s3Configured()) {
      return json({ error: "Amazon S3 is not configured for this project yet.", prefixes: [] }, 400);
    }
    const prefixes: {
      prefix: string;
      report_type: ReportType | null;
      list_ok: boolean;
      objects_seen: number;
      error: string | null;
    }[] = [];
    for (const { prefix, report_type } of ingestPrefixes()) {
      try {
        const objs = await listObjects(prefix, 5);
        prefixes.push({ prefix, report_type, list_ok: true, objects_seen: objs.length, error: null });
      } catch (e) {
        prefixes.push({
          prefix,
          report_type,
          list_ok: false,
          objects_seen: 0,
          error: errMsg(e).slice(0, 400),
        });
      }
    }
    return json({
      s3: s3BackendInfo(),
      list_available: prefixes.some((p) => p.list_ok),
      mode: prefixes.some((p) => p.list_ok) ? "auto-discovery" : "manual keys only",
      prefixes,
    });
  }

  // ---- Validate explicit keys (manual ingest fallback) ---------------------
  // Uses HeadObject only (same s3:GetObject permission), so it works even when
  // s3:ListBucket is denied. Accepts raw keys or s3://bucket/key URIs, and can
  // expand a manifest object that lists the delivery's keys.
  if (action === "validate_keys") {
    if (!s3Configured()) {
      return json({ error: "Amazon S3 is not configured for this project yet.", keys: [] }, 400);
    }
    const requested = Array.isArray(body.object_keys)
      ? (body.object_keys as unknown[]).map((k) => normalizeKeyInput(String(k))).filter(Boolean)
      : [];
    if (!requested.length) return json({ error: "object_keys is required", keys: [] }, 400);

    // Manifest expansion: a .json / .txt / .csv listing of keys.
    const expanded: string[] = [];
    const manifestNotes: string[] = [];
    for (const key of requested) {
      if (body.expand_manifest && isManifestKey(key)) {
        try {
          const keys = await readManifestKeys(key);
          manifestNotes.push(`${key}: expanded to ${keys.length} key(s)`);
          expanded.push(...keys);
        } catch (e) {
          manifestNotes.push(`${key}: manifest could not be read — ${errMsg(e).slice(0, 200)}`);
        }
      } else {
        expanded.push(key);
      }
    }

    const unique = Array.from(new Set(expanded)).slice(0, 200);
    const { data: ledger } = await admin
      .from("intuizi_ingest_files")
      .select("object_key,status,total_rows,processed_rows,finished_at")
      .in("object_key", unique);
    const ledgerMap = new Map((ledger ?? []).map((l) => [l.object_key, l]));

    const keys = [] as Record<string, unknown>[];
    for (const key of unique) {
      const isAudio = isAudioKey(key);
      const rt = isAudio ? null : reportTypeFromKey(key);
      const prior = ledgerMap.get(key) ?? null;
      try {
        const head = await headObject(key);
        keys.push({
          object_key: key,
          ok: head.size > 0,
          size: head.size,
          content_type: head.contentType,
          last_modified: head.lastModified,
          is_audio: isAudio,
          report_type: rt,
          needs_report_type: !isAudio && !rt,
          already_ingested: prior?.status === "done",
          prior_status: prior?.status ?? null,
          error: head.size > 0 ? null : "object is empty (0 bytes)",
        });
      } catch (e) {
        keys.push({
          object_key: key,
          ok: false,
          size: 0,
          is_audio: isAudio,
          report_type: rt,
          needs_report_type: !isAudio && !rt,
          already_ingested: prior?.status === "done",
          prior_status: prior?.status ?? null,
          error: errMsg(e).slice(0, 400),
        });
      }
    }
    return json({ keys, manifest_notes: manifestNotes, s3: s3BackendInfo() });
  }

  // ---- Activation readiness / enrichment coverage --------------------------
  // Answers "is this activation roster-only, tagged, or scored?" without
  // needing ListBucket.
  if (action === "readiness") {
    const activationId = typeof body.activation_id === "string" ? body.activation_id : null;

    const { data: files } = await admin
      .from("intuizi_ingest_files")
      .select("object_key,report_type,status,total_rows,processed_rows,failed_rows,finished_at")
      .order("discovered_at", { ascending: false })
      .limit(200);

    const matching = (files ?? []).filter((f) =>
      !activationId || (activationIdFromKey(f.object_key) ?? "unassigned") === activationId
    );

    // Identifier-level coverage per activation. One aggregate SQL pass — the
    // old per-column/per-activation `count(exact)` fan-out (up to ~150 round
    // trips) exceeded the invocation timeout on large deliveries, which the
    // client saw as "Failed to send a request to the Edge Function".
    const coverage: Record<string, { identifiers: number; tagged: number; scored: number }> = {};
    const { data: covRows, error: covErr } = await admin.rpc(
      "intuizi_activation_coverage",
      { p_activation: activationId },
    );
    if (covErr) return json({ error: covErr.message }, 500);
    for (const row of (covRows ?? []) as Array<{
      activation_id: string;
      identifiers: number;
      tagged: number;
      scored: number;
    }>) {
      coverage[row.activation_id] = {
        identifiers: Number(row.identifiers ?? 0),
        tagged: Number(row.tagged ?? 0),
        scored: Number(row.scored ?? 0),
      };
    }
    // Activations that have files but no identifiers yet still need a row.
    for (const f of files ?? []) {
      const act = activationIdFromKey(f.object_key) ?? "unassigned";
      if (!activationId || act === activationId) {
        coverage[act] ??= { identifiers: 0, tagged: 0, scored: 0 };
      }
    }



    const readinessOf = (c?: { identifiers: number; tagged: number; scored: number }) =>
      !c || c.identifiers === 0
        ? "not ingested"
        : c.scored > 0
          ? "scored"
          : c.tagged > 0
            ? "taxonomy present"
            : "roster only";

    const activations = Object.entries(coverage).map(([activation_id, c]) => ({
      activation_id,
      ...c,
      tag_coverage: c.identifiers ? c.tagged / c.identifiers : 0,
      readiness: readinessOf(c),
    })).sort((a, b) => b.identifiers - a.identifiers);

    return json({
      activation_id: activationId,
      readiness: activationId ? readinessOf(coverage[activationId]) : null,
      coverage: activationId ? (coverage[activationId] ?? null) : null,
      activations,
      files: matching,
      normalization_scope: "intuizi",
    });
  }


  // ---- Activation discovery (guided wizard) --------------------------------
  // Groups every inbound object by the `activation_id<N>` token in its name so
  // the wizard can offer a pick-list before running the semantic stages.
  if (action === "activations") {
    if (!s3Configured()) {
      return json({ error: "Amazon S3 is not connected for this project yet.", activations: [] }, 400);
    }
    type FileEntry = {
      object_key: string;
      report_type: ReportType | null;
      size: number;
      prefix: string;
      status: string | null;
      total_rows: number | null;
      processed_rows: number | null;
      finished_at: string | null;
      error_message: string | null;
    };
    const byActivation = new Map<string, FileEntry[]>();
    const listErrors: string[] = [];

    for (const { prefix, report_type } of ingestPrefixes()) {
      let objects: Awaited<ReturnType<typeof listObjects>> = [];
      try {
        objects = await listObjects(prefix, 200);
      } catch (e) {
        listErrors.push(`list ${prefix}: ${errMsg(e)}`);
        continue;
      }
      for (const o of objects) {
        if (o.key.endsWith("/")) continue;
        const activation = activationIdFromKey(o.key) ?? "unassigned";
        const list = byActivation.get(activation) ?? [];
        list.push({
          object_key: o.key,
          report_type: report_type ?? reportTypeFromKey(o.key),
          size: o.size,
          prefix,
          status: null,
          total_rows: null,
          processed_rows: null,
          finished_at: null,
          error_message: null,
        });
        byActivation.set(activation, list);
      }
    }

    const allKeys = [...byActivation.values()].flat().map((f) => f.object_key);
    if (allKeys.length) {
      const { data: ledger } = await admin
        .from("intuizi_ingest_files")
        .select("object_key,status,total_rows,processed_rows,finished_at,error_message")
        .in("object_key", allKeys);
      const ledgerMap = new Map((ledger ?? []).map((l) => [l.object_key, l]));
      for (const files of byActivation.values()) {
        for (const f of files) {
          const l = ledgerMap.get(f.object_key);
          if (!l) continue;
          f.status = l.status;
          f.total_rows = l.total_rows;
          f.processed_rows = l.processed_rows;
          f.finished_at = l.finished_at;
          f.error_message = l.error_message;
        }
      }
    }

    const activations = [...byActivation.entries()]
      .map(([activation_id, files]) => ({
        activation_id,
        // Summary reports carry the taxonomy rollup and must be ingested first —
        // roster files then link their device ids to that scored profile.
        files: files.sort((a, b) =>
          Number(b.prefix.includes("summary")) - Number(a.prefix.includes("summary")) ||
          a.object_key.localeCompare(b.object_key)
        ),
        empty_files: files.filter((f) => f.size <= 64).length,
        total_bytes: files.reduce((n, f) => n + f.size, 0),
        done_files: files.filter((f) => f.status === "done").length,
      }))
      .sort((a, b) => b.activation_id.localeCompare(a.activation_id));

    return json({ activations, errors: listErrors, s3: s3BackendInfo() });
  }

  if (action === "resume" || action === "pause") {
    if (isCron) return json({ error: `${action} requires an admin` }, 403);
    const paused = action === "pause";
    await admin.from("intuizi_ingest_state").update({
      paused,
      pause_reason: paused ? String(body.reason ?? "paused by admin") : null,
      paused_at: paused ? new Date().toISOString() : null,
      parked_until: null,
      consecutive_rate_limits: 0,
    }).eq("id", "singleton");
    return json({ paused });
  }

  if (!s3Configured()) {
    const info = s3BackendInfo();
    return json({
      error: info.placeholder
        ? "The enterprise S3 ingestion path is selected (S3_BACKEND=enterprise) but not configured yet — set S3_ENTERPRISE_BASE_URL and S3_ENTERPRISE_API_KEY, or unset S3_BACKEND to use the connector gateway."
        : "Amazon S3 is not connected for this project yet — link the inbound bucket connection, then run again.",
      s3_configured: false,
      s3: info,
    }, 400);
  }

  // ---- Paused / parked guard at the entry point ---------------------------
  let probeOnly = false;
  if (state?.parked_until && new Date(state.parked_until) > new Date()) {
    return json({ skipped: "parked after repeated rate limits", parked_until: state.parked_until });
  }
  if (state?.paused) {
    if (action === "run_now" && !isCron) {
      // An admin explicitly asked for a run while paused — treat it as a probe.
      probeOnly = true;
    } else {
      probeOnly = true;
    }
  }

  // ---- Single-flight lease ------------------------------------------------
  const leaseOwner = `intuizi-ingest:${crypto.randomUUID()}`;
  const { data: acquired, error: leaseErr } = await admin
    .rpc("acquire_intuizi_lease", { p_owner: leaseOwner, p_seconds: LEASE_SECONDS });
  if (leaseErr) return json({ error: `lease error: ${leaseErr.message}` }, 500);
  if (!acquired) return json({ skipped: "another run holds the lease" });

  rateMetrics.reset();
  const runStart = Date.now();
  // Wall-clock budget is tuned from recent run history so a resume that keeps
  // overrunning gets more headroom before the gateway's 150s idle limit.
  const prevSummary = (state?.last_run_summary ?? {}) as Record<string, unknown>;
  const history = Array.isArray(prevSummary.budget_history)
    ? (prevSummary.budget_history as BudgetHistoryEntry[])
    : [];
  const tuned = tuneRunBudget(history);
  const budgetMs = tuned.budgetMs;
  const outOfTime = () => Date.now() - runStart > budgetMs;
  /** Hard wall for any single object read, so no read outlives the run budget. */
  const readDeadlineAt = runStart + budgetMs;
  const timeLeftMs = () => Math.max(0, readDeadlineAt - Date.now());

  // ---- Dynamic work caps --------------------------------------------------
  // A WORKER_RESOURCE_LIMIT kill never gets to write a summary, so the caller
  // reports it on the retry and we re-run the same checkpoint with less work.
  const meter = createPhaseMeter();
  const caps = planWorkCaps(history, {
    shrink: Number(body.shrink ?? 0) || undefined,
    afterResourceLimit: Boolean(body.after_resource_limit),
    maxRows: Number(body.max_rows ?? 0) || undefined,
    maxFiles: Number(body.max_files ?? 0) || undefined,
    memPeakMb: Number(prevSummary.mem_peak_mb ?? 0) || null,
  });
  console.log(JSON.stringify({
    evt: "ingest_budget_tuned",
    budget_ms: budgetMs,
    default_budget_ms: RUN_BUDGET_MS,
    reason: tuned.reason,
    history_len: history.length,
    caps,
    mem: memSnapshot(),
  }));

  // One trace id per ingest run. It is written onto every queued scoring task
  // and echoed by the worker, so a CPU spike in the logs maps to an identifier.
  const runTraceId = newTraceId("ingest");
  console.log(JSON.stringify({ evt: "ingest_run_started", trace_id: runTraceId, caps }));

  const summary = {
    trace_id: runTraceId,
    /** Control-plane mode marker, so the UI can label the run correctly. */
    mode: "dispatch" as const,
    /** Report files handed to the EC2 worker this run. */
    files_dispatched: 0,
    /** Files left in `discovered` for the EC2 worker to lease (queue-free mode). */
    files_awaiting_pull: 0,

    /** Audio objects analysed inline (that path never left the edge). */
    files_processed: 0,
    files_failed: 0,
    audio_files_scored: 0,

    probe_only: probeOnly,
    paused: false,
    pause_reason: null as string | null,
    time_budget_exhausted: false,
    /** Server-side run budget (ms) the wizard uses to estimate remaining time. */
    run_budget_ms: budgetMs,
    /** Default budget before auto-tuning, for comparison in the wizard. */
    default_run_budget_ms: RUN_BUDGET_MS,
    /** Why the tuner picked this budget. */
    budget_reason: tuned.reason,
    /** Ms left in the budget when the run returned. */
    time_remaining_ms: budgetMs,
    /** Wall-clock duration of this run (ms). */
    elapsed_ms: 0,
    /** Per-step duration breakdown (ms). */
    phase_ms: { discover: 0, dispatch: 0, persist: 0, audio: 0 },
    /** Per-step CPU-time proxy + heap growth, to attribute a compute kill. */
    phase_usage: {} as Record<string, unknown>,
    /** Caps this run used, and why they were reduced. */
    work_caps: caps as unknown as Record<string, unknown>,
    /** Peak heap / RSS (MB) observed during the run. */
    mem_peak_mb: null as number | null,
    mem_peak_rss_mb: null as number | null,
    /** True when the run checkpointed early because the heap hit the soft limit. */
    memory_pressure: false,
    /** Rolling history the budget tuner reads on the next run. */
    budget_history: [] as BudgetHistoryEntry[],

    /** False when any file still has untransformed row groups or identifiers. */
    complete: true,
    /** Per-file resume state, so the caller can show partial/complete status. */
    files: [] as Record<string, unknown>[],
    errors: [] as string[],
    // Rate-limit telemetry for this run, filled in before responding.
    rate_metrics: null as Record<string, unknown> | null,
  };

  let breakerTripped = false;


  // audio_sources.user_id is required — attribute generated rows to an admin.
  let ownerId = actorId;
  if (!ownerId) {
    const { data: anyAdmin } = await admin
      .from("user_roles").select("user_id").eq("role", "admin")
      .order("created_at", { ascending: true }).limit(1).maybeSingle();
    ownerId = anyAdmin?.user_id ?? null;
  }

  try {
    if (!ownerId) throw new Error("No admin user exists to own ingested sources");

    // ---- Discover a bounded set of unprocessed objects --------------------
    const discoverStart = Date.now();

    const candidates: {
      key: string;
      report_type: ReportType | "audio";
      size: number;
      etag: string | null;
    }[] = [];
    const claimed = new Set<string>();

    const explicitKey = typeof body.object_key === "string" ? body.object_key : null;
    if (explicitKey) {
      if (isAudioKey(explicitKey)) {
        candidates.push({ key: explicitKey, report_type: "audio", size: 0, etag: null });
      } else {
        const requested = body.report_type as ReportType | undefined;
        const rt = requested ?? reportTypeFromKey(explicitKey) ?? undefined;
        if (!rt || !REPORT_TYPES.includes(rt)) {
          throw new Error(
            `could not infer report_type from "${explicitKey}" — pass report_type ` +
              `(one of ${REPORT_TYPES.join(", ")})`,
          );
        }
        candidates.push({ key: explicitKey, report_type: rt, size: 0, etag: null });
      }
    } else {
      for (const { prefix, report_type } of ingestPrefixes()) {
        if (candidates.length >= caps.files) break;
        let objects: Awaited<ReturnType<typeof listObjects>> = [];
        try {
          objects = await listObjects(prefix, 100);
        } catch (e) {
          const msg = errMsg(e);
          summary.errors.push(`list ${prefix}: ${msg}`);
          continue;
        }
        const dataObjects = objects.filter(
          (o) => o.size > 0 && !o.key.endsWith("/") && !claimed.has(o.key),
        );
        if (!dataObjects.length) continue;

        const { data: seen } = await admin
          .from("intuizi_ingest_files")
          .select("object_key,status,etag,heartbeat_at")
          .in("object_key", dataObjects.map((o) => o.key));

        // Skip finished files, and files a worker is actively holding. A claim
        // whose heartbeat went quiet is NOT skipped — it gets re-dispatched,
        // which is safe because the worker resumes from the saved cursor and
        // the score queue upsert is idempotent per (object_key, identifier).
        const staleBefore = Date.now() - STALE_CLAIM_MS;
        const skip = new Set(
          (seen ?? []).filter((s) => {
            if (s.status === "done") return true;
            if (s.status !== "enqueued" && s.status !== "processing") return false;
            const beat = s.heartbeat_at ? new Date(s.heartbeat_at).getTime() : 0;
            return beat >= staleBefore;
          }).map((s) => s.object_key),
        );
        const etags = new Map((seen ?? []).map((s) => [s.object_key, s.etag]));

        for (const o of dataObjects) {
          if (skip.has(o.key) || claimed.has(o.key)) continue;
          // A re-upload under the same key changes the ETag: treat it as new work.
          const knownEtag = etags.get(o.key);
          if (knownEtag && o.etag && knownEtag === o.etag && skip.has(o.key)) continue;
          // Audio files are ingested as real audio, not as report rows.
          const rt: ReportType | "audio" | null = isAudioKey(o.key)
            ? "audio"
            : (report_type ?? reportTypeFromKey(o.key));
          if (!rt) {
            summary.errors.push(`skipped ${o.key}: report type not recognizable from the file name`);
            continue;
          }
          claimed.add(o.key);
          candidates.push({ key: o.key, report_type: rt, size: o.size, etag: o.etag });
          if (candidates.length >= caps.files) break;
        }
      }
    }
    summary.phase_ms.discover = Date.now() - discoverStart;

    if (!candidates.length) {

      // Idle path stops here — it does not kick more work.
      await admin.from("intuizi_ingest_state").update({
        last_run_at: new Date().toISOString(),
        last_run_summary: { ...summary, idle: true },
        last_error: null,
      }).eq("id", "singleton");
      return json({ ...summary, idle: true });
    }

    for (const rawCand of candidates) {
      if (breakerTripped) break;
      if (outOfTime()) { summary.time_budget_exhausted = true; break; }
      if (meter.underPressure()) {
        summary.memory_pressure = true;
        summary.time_budget_exhausted = true;
        summary.complete = false;
        break;
      }

      // `discovered` is the pre-dispatch state: the row exists (so the ETag and
      // resume cursor are durable) but no worker owns it yet.
      const { data: fileRow, error: fileErr } = await admin
        .from("intuizi_ingest_files")
        .upsert({
          object_key: rawCand.key,
          report_type: rawCand.report_type,
          etag: rawCand.etag,
          size_bytes: rawCand.size || null,
          partition_date: partitionDateFromKey(rawCand.key),
          status: "discovered",
          started_at: new Date().toISOString(),
          error_message: null,
        }, { onConflict: "object_key" })
        .select(
          "id,report_type,processed_rows,row_group_cursor,rows_offset,row_groups_total,dispatch_attempts",
        ).single();
      if (fileErr) {
        summary.errors.push(`ledger ${rawCand.key}: ${fileErr.message}`);
        summary.files_failed++;
        continue;
      }

      // ---- Audio file: download + acoustic analysis, then ontology scoring --
      if (rawCand.report_type === "audio") {
        try {
          await ingestAudioObject(admin, {
            key: rawCand.key,
            ownerId: ownerId!,
            probeOnly,
          });
          await admin.from("intuizi_ingest_files").update({
            status: "done",
            total_rows: 1,
            processed_rows: 1,
            failed_rows: 0,
            cursor_offset: 1,
            finished_at: new Date().toISOString(),
            error_message: null,
          }).eq("id", fileRow.id);
          summary.files_processed++;
          summary.audio_files_scored++;
          // Nudge the background scorer so the audio identifier starts now
          // instead of waiting for the next scheduled worker tick.
          admin.functions.invoke("intuizi-score-worker", { body: { source: "ingest" } })
            .catch((e: unknown) => console.warn("score worker kick failed", errMsg(e)));
        } catch (e) {
          const msg = errMsg(e);
          await admin.from("intuizi_ingest_files").update({
            status: "failed",
            error_message: msg.slice(0, 2000),
            finished_at: new Date().toISOString(),
          }).eq("id", fileRow.id);
          summary.files_failed++;
          summary.errors.push(`${rawCand.key}: ${msg}`);
        }
        continue;
      }

      const cand = rawCand as {
        key: string;
        report_type: ReportType;
        size: number;
        etag: string | null;
      };

      // ---- Report file: DISPATCH ONLY ------------------------------------
      // No decoding here. One SQS message tells the EC2 DuckDB worker which
      // object to read and where to resume, and the worker reports rows back
      // through `ingest-worker-callback`, which enqueues the scoring tasks.
      try {
        if (!sqsConfigured()) {
          // Pull mode: no queue needed. The ledger row stays `discovered` and the
          // EC2 worker leases it through `ingest-worker-callback`, so discovery
          // is a success here, not a failure.
          summary.files_awaiting_pull++;
          summary.complete = false;
          summary.files.push({
            object_key: cand.key,
            report_type: cand.report_type,
            status: "discovered",
            complete: false,
            trace_id: `${runTraceId}.${cand.key.slice(-24)}`,
            message_id: null,
            row_group_cursor: Number(fileRow.row_group_cursor ?? 0) || 0,
            row_groups_total: fileRow.row_groups_total ?? null,
            dispatch_ms: 0,
          });
          console.log(JSON.stringify({
            evt: "ingest_file_awaiting_pull",
            trace_id: runTraceId,
            object_key: cand.key,
            report_type: cand.report_type,
          }));
          continue;
        }


        const endDispatch = meter.begin("dispatch");
        const dispatchStart = Date.now();
        const fileTraceId = `${runTraceId}.${cand.key.slice(-24)}`;
        const resumeGroup = Number(fileRow.row_group_cursor ?? 0) || 0;
        const resumeRowsOffset = Number(fileRow.rows_offset ?? 0) || 0;

        const sent = await sendIngestMessage({
          object_key: cand.key,
          report_type: cand.report_type,
          file_id: fileRow.id,
          activation_id: activationIdFromKey(cand.key),
          owner_id: ownerId,
          trace_id: fileTraceId,
          row_group_cursor: resumeGroup,
          rows_offset: resumeRowsOffset,
          max_rows: caps.rows,
        });

        const dispatchMs = Date.now() - dispatchStart;
        summary.phase_ms.dispatch += dispatchMs;
        endDispatch({ object_key: cand.key, message_id: sent.message_id });

        const endPersist = meter.begin("persist");
        const persistStart = Date.now();
        await admin.from("intuizi_ingest_files").update({
          status: "enqueued",
          enqueued_at: new Date().toISOString(),
          queue_message_id: sent.message_id,
          trace_id: fileTraceId,
          worker_id: null,
          heartbeat_at: new Date().toISOString(),
          dispatch_attempts: (Number(fileRow.dispatch_attempts ?? 0) || 0) + 1,
          error_message: null,
          finished_at: null,
        }).eq("id", fileRow.id);
        summary.phase_ms.persist += Date.now() - persistStart;
        endPersist({ object_key: cand.key });

        summary.files_dispatched++;
        // Dispatch is a handoff, not a completion: the run is only "complete"
        // once the worker closes every file out through the callback.
        summary.complete = false;

        console.log(JSON.stringify({
          evt: "ingest_file_dispatched",
          trace_id: fileTraceId,
          object_key: cand.key,
          report_type: cand.report_type,
          activation_id: activationIdFromKey(cand.key),
          resume_at_group: resumeGroup,
          resume_rows_offset: resumeRowsOffset,
          rows_per_message: caps.rows,
          message_id: sent.message_id,
          dispatch_ms: dispatchMs,
          time_remaining_ms: timeLeftMs(),
        }));

        summary.files.push({
          object_key: cand.key,
          report_type: cand.report_type,
          status: "enqueued",
          complete: false,
          trace_id: fileTraceId,
          message_id: sent.message_id,
          row_group_cursor: resumeGroup,
          row_groups_total: fileRow.row_groups_total ?? null,
          dispatch_ms: dispatchMs,
        });

        // A probe run (paused state) hands off exactly one file, so the operator
        // learns whether the queue path works again without draining the backlog.
        if (probeOnly) {
          await admin.from("intuizi_ingest_state").update({
            paused: false,
            pause_reason: null,
            paused_at: null,
            parked_until: null,
            consecutive_rate_limits: 0,
          }).eq("id", "singleton");
          break;
        }
      } catch (e) {
        const st = statusOf(e);
        const msg = errMsg(e);
        // Dispatch failed, so nothing is in flight: park the row back in
        // `discovered` rather than `failed`, so the next run retries it.
        await admin.from("intuizi_ingest_files").update({
          status: "discovered",
          error_message: msg.slice(0, 2000),
          dispatch_attempts: (Number(fileRow.dispatch_attempts ?? 0) || 0) + 1,
          finished_at: null,
        }).eq("id", fileRow.id);
        summary.files_failed++;
        summary.errors.push(`${cand.key}: ${msg}`);
        summary.complete = false;

        // A queue-level auth/permission problem will fail identically for every
        // remaining file — stop the run instead of burning the whole batch.
        if (st === 403 || /AccessDenied|InvalidClientTokenId|SignatureDoesNotMatch|not configured/i.test(msg)) {
          breakerTripped = true;
          summary.paused = true;
          summary.pause_reason = msg.slice(0, 500);
          await admin.from("intuizi_ingest_state").update({
            paused: true,
            pause_reason: msg.slice(0, 500),
            paused_at: new Date().toISOString(),
          }).eq("id", "singleton");
        }
      }
    }

    // Queue depth, so the caller sees how much work is still in flight after a
    // dispatch-only run (this run's own handoffs are part of it).
    try {
      const attrs = await queueAttributes();
      (summary as Json).queue = attrs;
    } catch (e) {
      (summary as Json).queue = { error: errMsg(e).slice(0, 300) };
    }

    if (summary.time_budget_exhausted || summary.files_failed || breakerTripped) {
      summary.complete = false;
    }
    summary.elapsed_ms = Date.now() - runStart;
    summary.time_remaining_ms = timeLeftMs();
    summary.phase_usage = meter.snapshot();
    summary.mem_peak_mb = meter.peakHeapMb();
    summary.mem_peak_rss_mb = meter.peakRssMb();
    summary.budget_history = [...history, {
      at: new Date().toISOString(),
      budget_ms: budgetMs,
      elapsed_ms: summary.elapsed_ms,
      timed_out: summary.time_budget_exhausted,
      resource_kill: Boolean(body.after_resource_limit) || summary.memory_pressure,
      mem_peak_mb: summary.mem_peak_mb ?? undefined,
      rows_cap: caps.rows,
    }].slice(-10);
    summary.rate_metrics = rateMetrics.snapshot();
    console.log(JSON.stringify({ evt: "ingest_run_summary", ...summary }));

    await admin.from("intuizi_ingest_state").update({
      last_run_at: new Date().toISOString(),
      last_run_summary: summary,
      last_error: summary.errors[0]?.slice(0, 1000) ?? null,
    }).eq("id", "singleton");

    return json(summary);


  } catch (e) {
    const msg = errMsg(e);
    summary.elapsed_ms = Date.now() - runStart;
    summary.time_remaining_ms = timeLeftMs();
    summary.phase_usage = meter.snapshot();
    summary.mem_peak_mb = meter.peakHeapMb();
    summary.mem_peak_rss_mb = meter.peakRssMb();
    summary.budget_history = [...history, {
      at: new Date().toISOString(),
      budget_ms: budgetMs,
      elapsed_ms: summary.elapsed_ms,
      timed_out: true,
      resource_kill: Boolean(body.after_resource_limit) || summary.memory_pressure,
      mem_peak_mb: summary.mem_peak_mb ?? undefined,
      rows_cap: caps.rows,
    }].slice(-10);
    summary.rate_metrics = rateMetrics.snapshot();

    console.error(JSON.stringify({ evt: "ingest_run_failed", error: msg, ...summary }));
    await admin.from("intuizi_ingest_state").update({
      last_run_at: new Date().toISOString(),
      last_run_summary: summary,
      last_error: msg.slice(0, 1000),
    }).eq("id", "singleton");
    return json({ ...summary, error: msg }, 500);

  } finally {
    // Always release the lease so a stuck run cannot block the schedule.
    try {
      await admin.rpc("release_intuizi_lease", { p_owner: leaseOwner });
    } catch (_) { /* best effort */ }
  }
});
