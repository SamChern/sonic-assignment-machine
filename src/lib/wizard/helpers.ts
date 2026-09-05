import { supabase } from "@/integrations/supabase/client";
import type { LedgerRow } from "@/lib/wizard/types";

export const PHASE_HISTORY_KEY = "sonicsim.ingest.phaseCpuHistory.v1";
/** How long the wizard waits on the background scorer before handing off. */
export const SCORE_WAIT_MS = 4 * 60_000;

export const PHASE_HISTORY_MAX = 12;

export const bytes = (n: number) =>
  n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`;

export const fileName = (key: string) => key.split("/").pop() ?? key;

/** Compact ms -> "45s" / "3m 20s" for resume time estimates. */
export const fmtDuration = (ms: number) => {
  const s = Math.max(1, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return rem ? `${m}m ${rem}s` : `${m}m`;
};

/** Shrink factors used when a run is killed for exceeding compute limits. */
export const RESOURCE_RETRY_SHRINK = [0.5, 0.25];

/** True when an invoke failure is the worker compute kill (546 / CPU or memory). */
export const isResourceLimit = (message: string, detail: string) => {
  const t = `${message} ${detail}`.toUpperCase();
  return t.includes("WORKER_RESOURCE_LIMIT") || t.includes("546") ||
    t.includes("CPU TIME") || t.includes("COMPUTE RESOURCES") || t.includes("MEMORY LIMIT");
};

/**
 * Invoke the ingest function for one file, retrying ONLY the unfinished chunk
 * with a smaller workload when the worker is killed for compute limits.
 * Each retry resumes from the persisted row-group cursor, so no work repeats.
 */
export async function invokeIngestWithRetry(
  body: Record<string, unknown>,
  onRetry?: (attempt: number, shrink: number, detail: string) => void,
) {
  let lastError: { message: string; detail: string } | null = null;
  for (let attempt = 0; attempt <= RESOURCE_RETRY_SHRINK.length; attempt++) {
    const shrink = attempt === 0 ? undefined : RESOURCE_RETRY_SHRINK[attempt - 1];
    const { data, error } = await supabase.functions.invoke("intuizi-ingest", {
      body: shrink ? { ...body, shrink, after_resource_limit: true } : body,
    });
    if (!error) return { data, error: null, retries: attempt, shrink };
    let detail = "";
    try {
      const ctx = (error as { context?: { text?: () => Promise<string> } }).context;
      if (ctx?.text) detail = await ctx.text();
    } catch { /* body already consumed */ }
    lastError = { message: error.message, detail };
    const next = RESOURCE_RETRY_SHRINK[attempt];
    if (!isResourceLimit(error.message, detail) || next === undefined) break;
    onRetry?.(attempt + 1, next, detail);
  }
  return { data: null, error: lastError, retries: RESOURCE_RETRY_SHRINK.length, shrink: undefined };
}

/** How long the wizard watches the off-platform worker before handing off. */
export const WORKER_WAIT_MS = 8 * 60_000;
export const WORKER_POLL_MS = 4_000;

/**
 * Poll the ingest ledger while the EC2 worker decodes and normalizes.
 *
 * The wizard no longer waits on an edge invocation (that is exactly what used to
 * hit the 150s gateway limit), so progress is read from the rows the worker
 * updates through `ingest-worker-callback`. Returns as soon as every file is in
 * a terminal state, or when the watch window closes — the transform keeps
 * running server-side either way.
 */
export async function awaitWorkerFiles(
  keys: string[],
  onProgress: (rows: LedgerRow[]) => void,
): Promise<LedgerRow[]> {
  const terminal = new Set(["done", "failed", "partial"]);
  const deadline = Date.now() + WORKER_WAIT_MS;
  let rows: LedgerRow[] = [];

  for (;;) {
    const { data } = await supabase
      .from("intuizi_ingest_files")
      .select(
        "object_key,status,processed_rows,total_rows,row_group_cursor,row_groups_total,error_message,heartbeat_at",
      )
      .in("object_key", keys);
    rows = (data ?? []) as LedgerRow[];
    onProgress(rows);

    const settled = rows.length === keys.length &&
      rows.every((r) => terminal.has(r.status));
    if (settled || Date.now() >= deadline) return rows;
    await new Promise((r) => setTimeout(r, WORKER_POLL_MS));
  }
}
