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

/** Audience size vs. match strength tradeoff curve. */
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
        <h3 className="text-sm font-semibold">Audience size vs. match strength</h3>
        <Badge variant="outline" className="text-[11px]">
          {retrieved} people considered
        </Badge>
        <Badge variant="outline" className="text-[11px]">
          minimum match strength {Math.round(threshold * 100)}%
        </Badge>
        <Badge className="text-[11px]">{atThresholdCount} people matched</Badge>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        Drag the slider: a higher minimum match strength means a stronger fit but fewer people.
        The shaded band shows how confident we are in each count.
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
          aria-label="Minimum match strength"
        />
      </div>
      <p className="mt-2 text-[11px] text-muted-foreground">
        Saving here creates this audience and keeps a comparison group aside, so you can measure
        what the audio actually changed.
      </p>
    </Card>
  );
};

export default ReachResonanceCard;
