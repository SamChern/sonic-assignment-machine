import { Card } from "@/components/ui/card";
import type { OutcomeResult } from "@/components/enterprise/outcomes/types";

export const LiftPriorsCard = ({ result }: { result: OutcomeResult }) => {
  if (result.lift_priors.length === 0) return null;
  return (
    <Card className="p-4">
      <h3 className="text-sm font-semibold">What the audio actually moved</h3>
      <p className="mt-1 text-[11px] text-muted-foreground">
        People who heard it vs. the withheld group, from live responses — a real difference, not a coincidence,
        and it feeds back into your calibration.
      </p>
      <div className="mt-3 space-y-1">
        {result.lift_priors.map((p) => (
          <div
            key={`${p.cohort_slug}-${p.category}`}
            className="flex flex-wrap items-center gap-2 rounded-lg border border-border/50 bg-muted/10 p-2 text-xs"
          >
            <span className="w-28 capitalize">{p.category}</span>
            <span className="min-w-0 flex-1 truncate text-muted-foreground">
              {p.cohort_slug}
            </span>
            <span className={p.lift >= 0 ? "text-primary" : "text-destructive"}>
              {p.lift >= 0 ? "+" : ""}
              {p.lift.toFixed(4)}
            </span>
            <span className="text-[11px] text-muted-foreground">
              {p.exposed_n} exposed / {p.holdout_n} holdout
            </span>
          </div>
        ))}
      </div>
    </Card>
  );
};
