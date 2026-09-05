import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { HelpCircle } from "lucide-react";
import type { OutcomeResult } from "@/components/enterprise/outcomes/types";

export const DriversCard = ({ result }: { result: OutcomeResult }) => {
  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-semibold">What moves {result.kpi}</h3>
        <Badge variant="outline" className="text-[11px]">
          {result.matched_rows} rows · fit {(result.r2 * 100).toFixed(0)}%
        </Badge>
        <Badge variant="outline" className="text-[11px]">
          avg {result.mean_actual.toFixed(3)}
        </Badge>
        <Badge variant="outline" className="text-[11px]">
          {result.conclusive_count} of 6 axes distinguishable
        </Badge>
      </div>
      <div className="mt-3 space-y-2">
        {result.drivers.map((d) => {
          const conclusive = result.drivers.filter((x) => !x.inconclusive);
          const max = Math.max(...conclusive.map((x) => Math.abs(x.coefficient)), 1e-9);
          const pct = Math.min(100, (Math.abs(d.coefficient) / max) * 100);
          return (
            <div
              key={d.category}
              className={`flex flex-wrap items-center gap-2 ${
                d.inconclusive ? "opacity-50" : ""
              }`}
            >
              <span className="w-28 text-xs capitalize">{d.category}</span>
              <div className="h-2 min-w-[100px] flex-1 overflow-hidden rounded bg-muted">
                <div
                  className={`h-full ${
                    d.inconclusive
                      ? "bg-muted-foreground/40"
                      : d.coefficient >= 0
                        ? "bg-primary"
                        : "bg-destructive"
                  }`}
                  style={{ width: `${d.inconclusive ? 12 : pct}%` }}
                />
              </div>
              {d.inconclusive ? (
                <span className="flex w-52 items-center justify-end gap-1 text-right text-[11px] text-muted-foreground">
                  <HelpCircle className="h-3 w-3" />
                  not yet distinguishable · needs more data
                </span>
              ) : (
                <span className="w-52 text-right text-[11px] text-muted-foreground">
                  {d.per_10_points >= 0 ? "+" : ""}
                  {d.per_10_points.toFixed(4)} / +10 pts
                  <span className="ml-1 opacity-70">
                    [{d.per_10_ci[0].toFixed(4)}, {d.per_10_ci[1].toFixed(4)}]
                  </span>
                </span>
              )}
            </div>
          );
        })}
      </div>
      <p className="mt-3 text-[11px] text-muted-foreground">
        Effects are ridge-regularized with {result.bootstrap_iters} bootstrap resamples on the{" "}
        {result.engine === "remote" ? "analysis worker" : "in-cloud fallback"}. Greyed rows are
        not yet distinguishable from zero — treat them as unknown, not as neutral.
      </p>
    </Card>
  );
};
