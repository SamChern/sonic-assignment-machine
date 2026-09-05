import { Badge } from "@/components/ui/badge";
import { fileName, fmtDuration } from "@/lib/wizard/helpers";
import type { ResumeEstimate } from "@/lib/wizard/types";

const ResumeForecastPanel = ({ resumeEstimates }: { resumeEstimates: ResumeEstimate[] }) => (
  <div className="w-full rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-xs">
    <p className="mb-2 font-medium text-amber-600 dark:text-amber-400">
      Resume forecast — each run stops at its tuned CPU-safe budget
    </p>
    <ul className="space-y-1">
      {resumeEstimates.map((e) => (
        <li key={e.key} className="flex flex-wrap items-center gap-x-2 gap-y-1 text-muted-foreground">
          <span className="font-mono text-foreground/90">{fileName(e.key)}</span>
          <span>
            row group {e.cursor}
            {e.total != null ? `/${e.total}` : ""}
            {e.groupsRemaining != null ? ` · ${e.groupsRemaining} left` : ""}
          </span>
          {e.groupsNextRun != null && (
            <Badge variant="outline" className="text-[10px]">
              ~{e.groupsNextRun} row group{e.groupsNextRun === 1 ? "" : "s"} next run
            </Badge>
          )}
          {e.etaMs != null && (
            <Badge variant="outline" className="text-[10px]">
              ~{fmtDuration(e.etaMs)} of processing left
              {e.runsRemaining != null ? ` · ~${e.runsRemaining} run${e.runsRemaining === 1 ? "" : "s"}` : ""}
            </Badge>
          )}
        </li>
      ))}
    </ul>
  </div>
);

export default ResumeForecastPanel;
