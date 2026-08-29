/**
 * Shared shapes and merge logic for the Ingestion Compatibility harness.
 *
 * Extracted from the page so the page itself stays under the component size
 * ceiling and the merge rules can be unit-tested without rendering the route.
 */

export type Status = "pass" | "warn" | "fail" | "skip";

export interface Check {
  id: string;
  feed: string;
  title: string;
  status: Status;
  detail: string;
  expected?: string;
  actual?: string;
  remediation?: string;
  evidence?: Record<string, unknown>;
  debug?: Record<string, unknown>;
}

export type Scope =
  | "all"
  | "object_store"
  | "intuizi"
  | "ec2_analysis"
  | "librosa_rest"
  | "semantic_svc"
  | "ec2_inference";

export interface SourceDef {
  scope: Exclude<Scope, "all">;
  label: string;
  /** Must equal the `feed` the edge function stamps on its checks. */
  feed: string;
}

export const SOURCES: SourceDef[] = [
  { scope: "object_store", label: "S3 object store", feed: "object store" },
  { scope: "intuizi", label: "Intuizi deliveries", feed: "intuizi" },
  { scope: "ec2_analysis", label: "EC2 analysis API", feed: "EC2 analysis API" },
  { scope: "semantic_svc", label: "Semantic service (CLAP)", feed: "Semantic service (CLAP)" },
  { scope: "ec2_inference", label: "EC2 inference server", feed: "EC2 inference server" },
  { scope: "librosa_rest", label: "Librosa REST", feed: "Librosa REST" },
];

export const scopeForFeed = (feed: string): Exclude<Scope, "all"> =>
  SOURCES.find((s) => s.feed === feed)?.scope ?? "intuizi";

export interface SampledObject {
  key: string;
  report_type: string;
  size: number;
  last_modified: string | null;
  rows_read: number;
  columns: string[];
  rows_with_identifier: number;
  summary_rows: number;
  roster_rows: number;
  normalized_rows: number;
}

export interface Report {
  ran_at: string;
  duration_ms: number;
  scope?: Scope;
  debug?: boolean;
  trace?: { at: number; step: string; detail?: unknown }[];
  backend?: { backend: string; configured: boolean; placeholder: boolean };
  discovered_objects?: number;
  summary: { pass: number; warn: number; fail: number; skip: number; total: number; verdict: string };
  checks: Check[];
  objects_sampled: SampledObject[];
}

export const ORDER: Status[] = ["fail", "warn", "pass", "skip"];

export const VERDICT_COPY: Record<string, string> = {
  compatible: "All standardized checks passed — feeds are ready for semantic analysis.",
  degraded: "Feeds are ingestible but some schema/metadata contracts drifted.",
  incompatible: "Blocking mismatches found — these deliveries will not be scored until fixed.",
};

/** Recompute the roll-up from the checks actually held in state. */
export function summarize(checks: Check[]): Report["summary"] {
  const summary = checks.reduce(
    (acc, c) => ({ ...acc, [c.status]: acc[c.status] + 1, total: acc.total + 1 }),
    { pass: 0, warn: 0, fail: 0, skip: 0, total: 0 } as Report["summary"],
  );
  summary.verdict = summary.fail > 0 ? "incompatible" : summary.warn > 0 ? "degraded" : "compatible";
  return summary;
}

/** Replace only the checks/samples belonging to the feeds a scoped run covered. */
export function mergeReport(prev: Report, next: Report): Report {
  const feeds = new Set(next.checks.map((c) => c.feed));
  const nextIds = new Set(next.checks.map((c) => c.id));
  // A scoped run can also re-emit shared checks (the object-store config checks
  // belong to both the store and Intuizi scopes), so drop by id as well as by
  // feed — otherwise the same check appears twice and skews the summary.
  const kept = prev.checks.filter((c) => !feeds.has(c.feed) && !nextIds.has(c.id));
  const checks = [...kept, ...next.checks];
  return {
    ...prev,
    ...next,
    summary: summarize(checks),
    checks,
    objects_sampled: next.objects_sampled.length ? next.objects_sampled : prev.objects_sampled,
    trace: next.trace ?? prev.trace,
  };
}
