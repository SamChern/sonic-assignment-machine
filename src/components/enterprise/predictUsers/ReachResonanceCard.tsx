import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Slider } from "@/components/ui/slider";
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip as ReTooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { CurvePoint } from "./types";

interface ReachResonanceCardProps {
  curve: CurvePoint[];
  retrieved: number;
  threshold: number;
  setThreshold: (value: number) => void;
  atThresholdCount: number;
}

/** Reach vs. resonance tradeoff curve for the similarity floor. */
const ReachResonanceCard = ({
  curve,
  retrieved,
  threshold,
  setThreshold,
  atThresholdCount,
}: ReachResonanceCardProps) => {
  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-semibold">Reach vs. resonance</h3>
        <Badge variant="outline" className="text-[11px]">
          {retrieved} neighbours retrieved
        </Badge>
        <Badge variant="outline" className="text-[11px]">
          similarity floor {threshold.toFixed(2)}
        </Badge>
        <Badge className="text-[11px]">{atThresholdCount} matched</Badge>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        Drag the floor: tighter resonance, smaller audience. The shaded band is the uncertainty
        implied by the calibration priors&apos; spread.
      </p>
      <div className="mt-3 h-52 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={curve} margin={{ top: 8, right: 8, bottom: 4, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
            <XAxis
              dataKey="threshold"
              tick={{ fontSize: 10 }}
              tickFormatter={(v: number) => v.toFixed(2)}
            />
            <YAxis tick={{ fontSize: 10 }} />
            <ReTooltip
              contentStyle={{ fontSize: 11 }}
              formatter={(v: number, n: string) => [v, n === "matched" ? "matched" : n]}
            />
            <Area
              type="monotone"
              dataKey="high"
              stroke="none"
              fill="hsl(var(--primary))"
              fillOpacity={0.14}
            />
            <Area
              type="monotone"
              dataKey="low"
              stroke="none"
              fill="hsl(var(--background))"
              fillOpacity={1}
            />
            <Line
              type="monotone"
              dataKey="matched"
              stroke="hsl(var(--primary))"
              strokeWidth={2}
              dot={false}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <div className="mt-2">
        <Slider
          value={[threshold * 100]}
          min={40}
          max={95}
          step={1}
          onValueChange={([v]) => setThreshold(v / 100)}
          aria-label="Similarity floor"
        />
      </div>
      <p className="mt-2 text-[11px] text-muted-foreground">
        Saving at this point writes a sonic cohort with a withheld holdout slice, ready for the
        activation lane and lift measurement.
      </p>
    </Card>
  );
};

export default ReachResonanceCard;
