import { Badge } from "@/components/ui/badge";
import { fileName, fmtDuration } from "@/lib/wizard/helpers";
import type { DeadlineInfo } from "@/lib/wizard/types";

const DeadlinePanel = ({ deadlines }: { deadlines: DeadlineInfo[] }) => (
  <div className="w-full rounded-lg border border-border/60 bg-muted/20 p-3 text-xs">
    <p className="mb-2 font-medium text-foreground/90">Run budget &amp; deadline</p>
    <ul className="space-y-1.5">
      {deadlines.map((d) => (
        <li key={d.key} className="flex flex-wrap items-center gap-x-2 gap-y-1 text-muted-foreground">
          <span className="font-mono text-foreground/90">{fileName(d.key)}</span>
          <Badge variant="outline" className="text-[10px]">
            budget {Math.round(d.budgetMs / 1000)}s
            {d.defaultBudgetMs != null && d.defaultBudgetMs !== d.budgetMs
              ? ` (default ${Math.round(d.defaultBudgetMs / 1000)}s)`
              : ""}
          </Badge>
          {d.elapsedMs != null && <span>{fmtDuration(d.elapsedMs)} used</span>}
          {d.timeRemainingMs != null && (
            <span>· {fmtDuration(Math.max(0, d.timeRemainingMs))} left at finish</span>
          )}
          {d.deadlineExceeded ? (
            <Badge variant="outline" className="border-amber-500/50 text-[10px] text-amber-600 dark:text-amber-400">
              deadline exceeded{d.deadlineStep ? ` at ${d.deadlineStep}` : ""}
            </Badge>
          ) : (
            <Badge variant="outline" className="border-emerald-500/50 text-[10px] text-emerald-600 dark:text-emerald-400">
              finished inside budget
            </Badge>
          )}
          {d.phaseMs && (
            <span className="font-mono text-[10px]">
              {Object.entries(d.phaseMs)
                .filter(([, v]) => v > 0)
                .map(([k, v]) => `${k} ${Math.round(v / 100) / 10}s`)
                .join(" · ")}
            </span>
          )}
          {d.budgetReason && <span className="italic">{d.budgetReason}</span>}
        </li>
      ))}
    </ul>
  </div>
);

export default DeadlinePanel;
