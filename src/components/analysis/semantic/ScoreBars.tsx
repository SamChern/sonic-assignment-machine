import { AnalysisRow, CATEGORY_KEYS } from "@/lib/semanticAnalysis";

export const ScoreBars = ({ ana }: { ana: AnalysisRow }) => (
  <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
    {CATEGORY_KEYS.map(([key, short, , gradient]) => {
      const value = Math.round(Number(ana[key]));
      return (
        <div key={key} className="flex items-center gap-2">
          <span className="w-8 shrink-0 text-[11px] font-medium text-muted-foreground">
            {short}
          </span>
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full transition-smooth"
              style={{ width: `${Math.max(2, Math.min(100, value))}%`, background: gradient }}
            />
          </div>
          <span className="w-7 shrink-0 text-right text-[11px] tabular-nums text-foreground/80">
            {value}
          </span>
        </div>
      );
    })}
  </div>
);

export default ScoreBars;
