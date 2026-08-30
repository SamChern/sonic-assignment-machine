// The resolver nudge — Step 13's feedback loop.
//
// Reads the cheap signal-health metrics the pipeline already keeps (unresolved
// symbol backlog, grounding coverage per branch, unreviewed agent proposals,
// how long since the agent last ran) and compares each one against a
// control_registry threshold. When a metric falls below (or a backlog rises
// above) its threshold, the resolver is nudged: the caller fires an agent
// refresh and the admin surface shows why.
//
// No model call happens here. This is pure measurement, so it is safe to poll
// from the admin dashboard.

import { controlNumber } from "./control.ts";

// deno-lint-ignore no-explicit-any
type Client = any;

export type NudgeSeverity = "ok" | "warn" | "critical";

export interface Nudge {
  id: string;
  title: string;
  detail: string;
  metric: number;
  threshold: number;
  severity: NudgeSeverity;
  /** Whether an agent refresh is the remedy (vs. a human review action). */
  refresh: boolean;
  action: string;
}

export interface NudgeReport {
  nudges: Nudge[];
  triggered: boolean;
  /** Highest severity across triggered nudges. */
  severity: NudgeSeverity;
  metrics: {
    pending: number;
    failed: number;
    unreviewed: number;
    min_coverage_pct: number;
    weakest_branch: string | null;
    hours_since_run: number | null;
  };
  thresholds: {
    max_pending: number;
    min_coverage_pct: number;
    max_unreviewed: number;
    stale_hours: number;
  };
  checked_at: string;
}

async function countQueue(admin: Client, status: string): Promise<number> {
  const { count } = await admin
    .from("resolution_queue")
    .select("id", { count: "exact", head: true })
    .eq("status", status);
  return count ?? 0;
}

/** Weakest grounded branch, via the existing grounding_coverage() view fn. */
async function weakestCoverage(
  admin: Client,
): Promise<{ pct: number; branch: string | null }> {
  const { data, error } = await admin.rpc("grounding_coverage");
  if (error || !Array.isArray(data) || data.length === 0) {
    return { pct: 100, branch: null };
  }
  let worst = { pct: 100, branch: null as string | null };
  for (const row of data as { branch: string; coverage_pct: number | null }[]) {
    const pct = Number(row.coverage_pct ?? 0);
    if (!Number.isFinite(pct)) continue;
    if (pct < worst.pct) worst = { pct, branch: row.branch };
  }
  return worst;
}

/**
 * Measure signal health and decide whether the Resolver should be nudged.
 * `state` is the resolver's job_worker_state row (for last_kick_at).
 */
export async function buildNudgeReport(
  admin: Client,
  state: { last_kick_at?: string | null } | null,
): Promise<NudgeReport> {
  const [maxPending, minCoverage, maxUnreviewed, staleHours] = await Promise.all([
    controlNumber(admin, "resolver.nudge_max_pending", 25, { min: 1, max: 100_000 }),
    controlNumber(admin, "resolver.nudge_min_coverage_pct", 60, { min: 0, max: 100 }),
    controlNumber(admin, "resolver.nudge_max_unreviewed", 25, { min: 1, max: 5000 }),
    controlNumber(admin, "resolver.nudge_stale_hours", 36, { min: 1, max: 720 }),
  ]);

  const [pending, failed, coverage] = await Promise.all([
    countQueue(admin, "pending"),
    countQueue(admin, "failed"),
    weakestCoverage(admin),
  ]);

  const { count: unreviewedCount } = await admin
    .from("taxonomy_nodes")
    .select("id", { count: "exact", head: true })
    .eq("source", "agent")
    .eq("reviewed", false);
  const unreviewed = unreviewedCount ?? 0;

  const hoursSinceRun = state?.last_kick_at
    ? (Date.now() - new Date(state.last_kick_at).getTime()) / 3_600_000
    : null;

  const nudges: Nudge[] = [];

  if (pending > maxPending) {
    nudges.push({
      id: "backlog",
      title: "Unresolved symbols are piling up",
      detail:
        `${pending} delivered symbols have no meaning in the graph yet ` +
        `(threshold ${maxPending}). Every one of them is signal the scorer is ` +
        `currently throwing away.`,
      metric: pending,
      threshold: maxPending,
      severity: pending > maxPending * 4 ? "critical" : "warn",
      refresh: true,
      action: "run",
    });
  }

  if (coverage.branch && coverage.pct < minCoverage) {
    nudges.push({
      id: "coverage",
      title: `Grounding is thin in ${coverage.branch}`,
      detail:
        `${coverage.pct.toFixed(1)}% of observed weight in the ${coverage.branch} ` +
        `branch is grounded (floor ${minCoverage}%). Scores there lean on ` +
        `priors rather than evidence.`,
      metric: Number(coverage.pct.toFixed(1)),
      threshold: minCoverage,
      severity: coverage.pct < minCoverage / 2 ? "critical" : "warn",
      refresh: true,
      action: "run",
    });
  }

  if (hoursSinceRun !== null && hoursSinceRun > staleHours) {
    nudges.push({
      id: "stale",
      title: "The agent has not refreshed recently",
      detail:
        `Last resolver run was ${Math.round(hoursSinceRun)}h ago ` +
        `(threshold ${staleHours}h). New symbols arrive with every ingest.`,
      metric: Math.round(hoursSinceRun),
      threshold: staleHours,
      severity: hoursSinceRun > staleHours * 3 ? "critical" : "warn",
      refresh: true,
      action: "run",
    });
  } else if (hoursSinceRun === null && pending > 0) {
    nudges.push({
      id: "never-run",
      title: "The agent has never run",
      detail: `${pending} symbols are queued and no resolver run is on record.`,
      metric: pending,
      threshold: 0,
      severity: "warn",
      refresh: true,
      action: "run",
    });
  }

  if (unreviewed > maxUnreviewed) {
    nudges.push({
      id: "review",
      title: "Agent proposals are waiting on you",
      detail:
        `${unreviewed} resolved symbols sit unreviewed (threshold ${maxUnreviewed}). ` +
        `They stay out of the live graph until approved.`,
      metric: unreviewed,
      threshold: maxUnreviewed,
      severity: "warn",
      refresh: false,
      action: "review",
    });
  }

  const severity: NudgeSeverity = nudges.some((n) => n.severity === "critical")
    ? "critical"
    : nudges.length
    ? "warn"
    : "ok";

  return {
    nudges,
    triggered: nudges.some((n) => n.refresh),
    severity,
    metrics: {
      pending,
      failed,
      unreviewed,
      min_coverage_pct: Number(coverage.pct.toFixed(1)),
      weakest_branch: coverage.branch,
      hours_since_run: hoursSinceRun === null ? null : Number(hoursSinceRun.toFixed(1)),
    },
    thresholds: {
      max_pending: maxPending,
      min_coverage_pct: minCoverage,
      max_unreviewed: maxUnreviewed,
      stale_hours: staleHours,
    },
    checked_at: new Date().toISOString(),
  };
}
