import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AlertTriangle, Loader2, Play, TrendingUp } from "lucide-react";
import type { LiftReport } from "@/components/enterprise/outcomes/types";

export const MeasureLiftCard = ({
  cohortSlugs,
  liftSlug,
  setLiftSlug,
  measureLift,
  liftRunning,
  liftError,
  lift,
}: {
  cohortSlugs: { slug: string; name: string }[];
  liftSlug: string;
  setLiftSlug: (v: string) => void;
  measureLift: () => void;
  liftRunning: boolean;
  liftError: string | null;
  lift: LiftReport | null;
}) => {
  if (cohortSlugs.length === 0) return null;
  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-center gap-2">
        <TrendingUp className="h-4 w-4 text-primary" />
        <h3 className="text-sm font-semibold">Measure the difference it made</h3>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        Every audience file holds back about one person in ten. Comparing how the people who
        heard it responded against that withheld group shows the difference the audio made —
        not just a coincidence — and it feeds straight back into how we score.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Select value={liftSlug} onValueChange={setLiftSlug}>
          <SelectTrigger className="w-[240px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {cohortSlugs.map((c) => (
              <SelectItem key={c.slug} value={c.slug}>
                {c.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button size="sm" variant="outline" onClick={measureLift} disabled={liftRunning || !liftSlug}>
          {liftRunning ? (
            <Loader2 className="mr-1 h-4 w-4 animate-spin" />
          ) : (
            <Play className="mr-1 h-4 w-4" />
          )}
          Measure the difference
        </Button>
      </div>
      {liftError && (
        <p className="mt-3 flex items-start gap-1 text-[11px] text-destructive">
          <AlertTriangle className="mt-[2px] h-3 w-3 shrink-0" />
          {liftError}
        </p>
      )}
      {lift && (
        <div className="mt-3 space-y-1 text-xs">
          <p>
            People who heard it: {lift.exposed_mean.toFixed(4)} ({lift.exposed_events}{" "}
            responses) · withheld group: {lift.holdout_mean.toFixed(4)} ({lift.holdout_events}{" "}
            responses)
          </p>
          <p className={lift.absolute_lift >= 0 ? "text-primary" : "text-destructive"}>
            Difference {lift.absolute_lift >= 0 ? "+" : ""}
            {lift.absolute_lift.toFixed(4)}
            {lift.relative_lift !== null && ` (${(lift.relative_lift * 100).toFixed(1)}%)`}
          </p>
          {lift.note && <p className="text-[11px] text-muted-foreground">{lift.note}</p>}
          {lift.priors_written > 0 && (
            <p className="text-[11px] text-muted-foreground">
              {lift.priors_written} per-axis priors written back to calibration.
            </p>
          )}
        </div>
      )}
    </Card>
  );
};
