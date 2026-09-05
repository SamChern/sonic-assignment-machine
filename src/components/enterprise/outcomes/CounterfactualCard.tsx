import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Slider } from "@/components/ui/slider";
import { TrendingUp } from "lucide-react";
import type { CategoryName, Counterfactual, OutcomeResult } from "@/components/enterprise/outcomes/types";

export const CounterfactualCard = ({
  result,
  deltas,
  setDeltas,
  counterfactual,
}: {
  result: OutcomeResult;
  deltas: Record<CategoryName, number>;
  setDeltas: (updater: (p: Record<CategoryName, number>) => Record<CategoryName, number>) => void;
  counterfactual: Counterfactual;
}) => {
  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-center gap-2">
        <TrendingUp className="h-4 w-4 text-primary" />
        <h3 className="text-sm font-semibold">Counterfactual planning</h3>
        <Badge variant="outline" className="text-[11px]">
          predicted {counterfactual.predicted.toFixed(4)}
        </Badge>
        <Badge
          variant={counterfactual.conclusive ? "default" : "outline"}
          className="text-[11px]"
        >
          {counterfactual.delta >= 0 ? "+" : ""}
          {counterfactual.delta.toFixed(4)} vs. today
        </Badge>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        Move an axis and see the predicted change in {result.kpi}, with the interval the data
        actually supports. Intervals from inconclusive axes are excluded from the total.
      </p>
      <div className="mt-3 space-y-3">
        {result.drivers.map((d) => (
          <div key={`cf-${d.category}`} className="flex flex-wrap items-center gap-2">
            <span className="w-28 text-xs capitalize">{d.category}</span>
            <Slider
              value={[deltas[d.category as CategoryName] ?? 0]}
              min={-20}
              max={20}
              step={1}
              aria-label={`${d.category} delta`}
              onValueChange={([v]) =>
                setDeltas((p) => ({ ...p, [d.category as CategoryName]: v }))
              }
              className="min-w-[140px] flex-1"
            />
            <span className="w-28 text-right text-[11px] text-muted-foreground">
              {(deltas[d.category as CategoryName] ?? 0) >= 0 ? "+" : ""}
              {deltas[d.category as CategoryName] ?? 0} pts
              {d.inconclusive && " · unknown"}
            </span>
          </div>
        ))}
      </div>
      <p className="mt-3 text-[11px] text-muted-foreground">
        Interval: {counterfactual.conclusive
          ? `${counterfactual.ciLow.toFixed(4)} to ${counterfactual.ciHigh.toFixed(4)}`
          : "no distinguishable axis moved — no interval to report"}
      </p>
    </Card>
  );
};
