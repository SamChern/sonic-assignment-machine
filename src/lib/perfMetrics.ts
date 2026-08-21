// Lightweight client-side performance instrumentation for the identifier
// surfaces. Everything is in-memory and dependency-free: a small ring buffer of
// samples per metric so we can show p50/p95 without shipping an analytics SDK
// or paying network cost as datasets grow into the thousands.

export type PerfMetric =
  | "identifier.query"
  | "identifier.filter"
  | "identifier.render"
  | "page.load";

const MAX_SAMPLES = 60;

export interface PerfSample {
  ms: number;
  /** Rows involved (query rows, filtered rows, rendered rows…). */
  count?: number;
  at: number;
}

export interface PerfStat {
  metric: PerfMetric;
  last: number;
  p50: number;
  p95: number;
  max: number;
  samples: number;
  lastCount?: number;
}

const buffers = new Map<PerfMetric, PerfSample[]>();
const listeners = new Set<() => void>();

const DEBUG_KEY = "sonicsim:perf-debug";

function debugEnabled(): boolean {
  try {
    return localStorage.getItem(DEBUG_KEY) === "1";
  } catch {
    return false;
  }
}

export function setPerfDebug(on: boolean) {
  try {
    if (on) localStorage.setItem(DEBUG_KEY, "1");
    else localStorage.removeItem(DEBUG_KEY);
  } catch {
    /* storage unavailable — logging just stays off */
  }
}

export function isPerfDebug(): boolean {
  return debugEnabled();
}

export function recordPerf(metric: PerfMetric, ms: number, count?: number) {
  if (!Number.isFinite(ms) || ms < 0) return;
  const buf = buffers.get(metric) ?? [];
  buf.push({ ms, count, at: Date.now() });
  if (buf.length > MAX_SAMPLES) buf.shift();
  buffers.set(metric, buf);

  if (debugEnabled()) {
    // eslint-disable-next-line no-console
    console.info(
      `[perf] ${metric} ${ms.toFixed(1)}ms${count === undefined ? "" : ` · ${count} rows`}`,
    );
  }

  for (const fn of listeners) fn();
}

/** Time an async operation and record the result. */
export async function measurePerf<T>(
  metric: PerfMetric,
  fn: () => Promise<T>,
  countOf?: (result: T) => number,
): Promise<T> {
  const t0 = performance.now();
  try {
    const result = await fn();
    recordPerf(metric, performance.now() - t0, countOf?.(result));
    return result;
  } catch (err) {
    recordPerf(metric, performance.now() - t0);
    throw err;
  }
}

/** Time a synchronous operation (filtering passes) and record the result. */
export function measurePerfSync<T>(metric: PerfMetric, fn: () => T, count?: (r: T) => number): T {
  const t0 = performance.now();
  const result = fn();
  recordPerf(metric, performance.now() - t0, count?.(result));
  return result;
}

function percentile(sorted: number[], q: number): number {
  if (!sorted.length) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor(q * (sorted.length - 1)));
  return sorted[idx];
}

export function perfStat(metric: PerfMetric): PerfStat | null {
  const buf = buffers.get(metric);
  if (!buf?.length) return null;
  const sorted = buf.map((s) => s.ms).sort((a, b) => a - b);
  const last = buf[buf.length - 1];
  return {
    metric,
    last: last.ms,
    lastCount: last.count,
    p50: percentile(sorted, 0.5),
    p95: percentile(sorted, 0.95),
    max: sorted[sorted.length - 1],
    samples: buf.length,
  };
}

export function perfStats(metrics: PerfMetric[]): PerfStat[] {
  return metrics.map(perfStat).filter((s): s is PerfStat => !!s);
}

export function resetPerf() {
  buffers.clear();
  for (const fn of listeners) fn();
}

export function subscribePerf(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/**
 * Navigation timing for the current document, recorded once. Uses the
 * PerformanceNavigationTiming entry so there is no extra measurement cost.
 */
let pageLoadRecorded = false;
export function recordPageLoad() {
  if (pageLoadRecorded || typeof performance === "undefined") return;
  const [nav] = performance.getEntriesByType("navigation") as PerformanceNavigationTiming[];
  if (!nav) return;
  const ms = nav.duration || nav.loadEventEnd - nav.startTime;
  if (ms > 0) {
    pageLoadRecorded = true;
    recordPerf("page.load", ms);
  }
}

export const PERF_LABELS: Record<PerfMetric, string> = {
  "identifier.query": "Query",
  "identifier.filter": "Filter",
  "identifier.render": "Render",
  "page.load": "Page load",
};
