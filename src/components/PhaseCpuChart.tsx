import { useMemo } from "react";
import { Badge } from "@/components/ui/badge";

/** One phase's cost within a single ingest invocation. */
export interface PhaseSample {
  ms: number;
  peakHeapMb: number | null;
  heapDeltaMb: number | null;
}

/** One ingest invocation's phase breakdown, newest last. */
export interface PhaseRun {
  /** Object key of the file this run processed. */
  key: string;
  at: number;
  /** Total wall/CPU time the server reported for the run. */
  elapsedMs: number | null;
  /** Phase name -> cost. */
  phases: Record<string, PhaseSample>;
  /** The run hit (or was retried out of) a worker compute limit. */
  resourceLimit: boolean;
  /** Server checkpointed early because heap crossed the soft limit. */
  memoryPressure: boolean;
  /** Phase named by the server when a deadline/limit stopped the run. */
  culprit: string | null;
}

const PHASE_ORDER = ["discover", "sign", "read", "normalize", "score", "persist"] as const;

/** Stable token-based color per phase; unknown phases cycle the same ramp. */
const phaseColor = (phase: string, index: number) => {
  const known = PHASE_ORDER.indexOf(phase as (typeof PHASE_ORDER)[number]);
  const slot = (known >= 0 ? known : index) % 5;
  return `hsl(var(--chart-${slot + 1}))`;
};

const fileName = (key: string) => key.split("/").pop() ?? key;
const secs = (ms: number) => `${Math.round(ms / 100) / 10}s`;

/**
 * Stacked per-run CPU-time chart. Each bar is one ingest invocation, segmented
 * by phase, so the step that dominates (and the step present when a run gets
 * killed) is visible at a glance across runs.
 */
const PhaseCpuChart = ({ runs }: { runs: PhaseRun[] }) => {
  const model = useMemo(() => {
    const phases = new Set<string>();
    for (const r of runs) for (const p of Object.keys(r.phases)) phases.add(p);
    const ordered = [
      ...PHASE_ORDER.filter((p) => phases.has(p)),
      ...[...phases].filter((p) => !PHASE_ORDER.includes(p as (typeof PHASE_ORDER)[number])).sort(),
    ];

    const bars = runs.map((r) => {
      const segs = ordered
        .map((p) => ({ phase: p, ms: r.phases[p]?.ms ?? 0, peak: r.phases[p]?.peakHeapMb ?? null }))
        .filter((s) => s.ms > 0);
      const total = segs.reduce((a, s) => a + s.ms, 0);
      return { run: r, segs, total };
    });

    const maxTotal = Math.max(1, ...bars.map((b) => b.total));

    // Aggregate: mean share per phase, plus how often a phase is the biggest
    // slice of a run that hit the compute limit.
    const totals = new Map<string, number>();
    const killShare = new Map<string, number>();
    let kills = 0;
    for (const b of bars) {
      for (const s of b.segs) totals.set(s.phase, (totals.get(s.phase) ?? 0) + s.ms);
      if (!b.run.resourceLimit && !b.run.memoryPressure) continue;
      kills++;
      const worst = b.run.culprit ?? b.segs.slice().sort((x, y) => y.ms - x.ms)[0]?.phase;
      if (worst) killShare.set(worst, (killShare.get(worst) ?? 0) + 1);
    }
    const grand = [...totals.values()].reduce((a, v) => a + v, 0) || 1;
    const legend = ordered
      .filter((p) => (totals.get(p) ?? 0) > 0)
      .map((p, i) => ({
        phase: p,
        color: phaseColor(p, i),
        share: (totals.get(p) ?? 0) / grand,
        kills: killShare.get(p) ?? 0,
      }))
      .sort((a, b) => b.share - a.share);

    return { ordered, bars, maxTotal, legend, kills };
  }, [runs]);

  if (!runs.length) return null;

  const worstOffender = model.legend.find((l) => l.kills > 0) ?? model.legend[0];

  return (
    <div className="w-full rounded-lg border border-border/60 bg-muted/20 p-3 text-xs">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <p className="font-medium text-foreground/90">Per-phase CPU time by run</p>
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge variant="outline" className="text-[10px]">
            {runs.length} run{runs.length === 1 ? "" : "s"}
          </Badge>
          {model.kills > 0 && (
            <Badge
              variant="outline"
              className="border-amber-500/50 text-[10px] text-amber-600 dark:text-amber-400"
            >
              {model.kills} compute-limited
            </Badge>
          )}
          {worstOffender && (
            <Badge variant="outline" className="text-[10px]">
              heaviest: {worstOffender.phase} {Math.round(worstOffender.share * 100)}%
            </Badge>
          )}
        </div>
      </div>

      <ul className="space-y-1.5" aria-label="Per-phase CPU time for each ingest run">
        {model.bars.map((b, idx) => {
          const flagged = b.run.resourceLimit || b.run.memoryPressure;
          return (
            <li key={`${b.run.key}-${b.run.at}-${idx}`} className="space-y-1">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-muted-foreground">
                <span className="font-mono text-foreground/90">{fileName(b.run.key)}</span>
                <span>{secs(b.total)} CPU</span>
                {b.run.elapsedMs != null && b.run.elapsedMs > b.total && (
                  <span>· {secs(b.run.elapsedMs)} wall</span>
                )}
                {flagged && (
                  <span className="text-amber-600 dark:text-amber-400">
                    · {b.run.resourceLimit ? "compute limit" : "memory pressure"}
                    {b.run.culprit ? ` at ${b.run.culprit}` : ""}
                  </span>
                )}
              </div>
              <div
                className={`flex h-3 w-full overflow-hidden rounded-full bg-muted ${
                  flagged ? "ring-1 ring-amber-500/50" : ""
                }`}
                style={{ maxWidth: `${Math.max(12, (b.total / model.maxTotal) * 100)}%` }}
                role="img"
                aria-label={`${fileName(b.run.key)}: ${b.segs
                  .map((s) => `${s.phase} ${secs(s.ms)}`)
                  .join(", ")}`}
              >
                {b.segs.map((s, i) => (
                  <div
                    key={s.phase}
                    className="h-full"
                    style={{
                      width: `${(s.ms / b.total) * 100}%`,
                      backgroundColor: phaseColor(s.phase, i),
                    }}
                    title={`${s.phase}: ${secs(s.ms)}${
                      s.peak != null ? ` · peak heap ${Math.round(s.peak)} MB` : ""
                    }`}
                  />
                ))}
              </div>
            </li>
          );
        })}
      </ul>

      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-muted-foreground">
        {model.legend.map((l) => (
          <span key={l.phase} className="flex items-center gap-1">
            <span
              className="inline-block h-2 w-2 rounded-full"
              style={{ backgroundColor: l.color }}
              aria-hidden="true"
            />
            {l.phase} {Math.round(l.share * 100)}%
            {l.kills > 0 ? ` · ${l.kills} kill${l.kills === 1 ? "" : "s"}` : ""}
          </span>
        ))}
      </div>
    </div>
  );
};

export default PhaseCpuChart;
