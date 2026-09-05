import { ChevronDown } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import StageIcon from "@/components/wizard/StageIcon";
import { STAGES } from "@/lib/wizard/types";
import type { StageKey, StageResult } from "@/lib/wizard/types";

interface StageListProps {
  results: Partial<Record<StageKey, StageResult>>;
  expandedStages: StageKey[];
  setExpandedStages: React.Dispatch<React.SetStateAction<StageKey[]>>;
}

const StageList = ({ results, expandedStages, setExpandedStages }: StageListProps) => (
  <ol className="mt-5 space-y-2">
    {STAGES.map(([key, label], i) => {
      const res = results[key];
      const state = res?.state ?? "idle";
      const hasDetails = !!res?.outputs?.length || !!res?.notes?.length;
      const open = expandedStages.includes(key);
      const tone =
        state === "ok"
          ? "border-primary/40 bg-primary/5"
          : state === "warn"
            ? "border-amber-500/40 bg-amber-500/5"
            : state === "error"
              ? "border-destructive/40 bg-destructive/5"
              : "border-border bg-muted/20";
      const pct = state === "ok" ? 100 : state === "running" ? 60 : state === "idle" ? 0 : 100;
      const barTone =
        state === "error"
          ? "[&>div]:bg-destructive"
          : state === "warn"
            ? "[&>div]:bg-amber-500"
            : "";
      return (
        <li key={key} className={`rounded-lg border px-3 py-2 ${tone}`}>
          <button
            type="button"
            onClick={() =>
              hasDetails &&
              setExpandedStages((prev) =>
                prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key],
              )}
            aria-expanded={open}
            disabled={!hasDetails}
            className="flex w-full items-center gap-2 text-left disabled:cursor-default"
          >
            <StageIcon state={state} />
            <span className="min-w-0 flex-1">
              <span className="flex items-baseline gap-2">
                <span className="truncate text-xs font-medium">
                  {i + 1}. {label}
                </span>
                <span className="ml-auto shrink-0 text-[11px] text-muted-foreground">
                  {res?.summary ?? "not started"}
                </span>
              </span>
              <Progress
                value={pct}
                className={`mt-1.5 h-1 ${barTone} ${state === "running" ? "animate-pulse" : ""}`}
              />
            </span>
            {hasDetails && (
              <ChevronDown
                className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`}
                aria-hidden="true"
              />
            )}
          </button>

          {open && !!res?.outputs?.length && (
            <div className="mt-2 grid gap-1 sm:grid-cols-2">
              {res.outputs.map(([k, v]) => (
                <div
                  key={`${k}-${v}`}
                  className="flex items-baseline justify-between gap-2 rounded border border-border/60 bg-background/60 px-2 py-1"
                >
                  <span className="truncate text-[11px] text-muted-foreground" title={k}>
                    {k}
                  </span>
                  <span className="whitespace-nowrap text-[11px] font-medium">{v}</span>
                </div>
              ))}
            </div>
          )}

          {open && !!res?.notes?.length && (
            <ul className="mt-2 space-y-1">
              {res.notes.map((n) => (
                <li key={n} className="text-[11px] text-muted-foreground break-all">
                  • {n}
                </li>
              ))}
            </ul>
          )}
        </li>
      );
    })}
  </ol>
);

export default StageList;
