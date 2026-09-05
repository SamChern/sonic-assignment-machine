import { Badge } from "@/components/ui/badge";
import { fileName, fmtDuration } from "@/lib/wizard/helpers";
import type { LiveRun } from "@/lib/wizard/types";

/** Shows the "aborts in Ns" countdown for the run currently in flight. */
const LiveRunBanner = ({ liveRun }: { liveRun: LiveRun }) => {
  const elapsed = Date.now() - liveRun.startedAt;
  const left = Math.max(0, liveRun.budgetMs - elapsed);
  const pct = Math.min(100, Math.round((elapsed / liveRun.budgetMs) * 100));
  return (
    <div
      className="w-full rounded-lg border border-primary/30 bg-primary/5 p-3 text-xs"
      role="status"
      aria-live="polite"
    >
      <div className="mb-2 flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="font-mono text-foreground/90">{fileName(liveRun.key)}</span>
        <span className="text-muted-foreground">
          {fmtDuration(elapsed)} elapsed
        </span>
        <Badge variant="outline" className="text-[10px]">
          {left > 0
            ? `aborts in ~${fmtDuration(left)}`
            : "past budget — checkpointing"}
        </Badge>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-primary transition-all"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
};

export default LiveRunBanner;
