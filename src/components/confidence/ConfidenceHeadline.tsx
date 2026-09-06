import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Slider } from "@/components/ui/slider";
import { SlidersHorizontal } from "lucide-react";
import { type DriverRow, type TagRow, computeMath } from "@/lib/confidenceBreakdown";

type Math = ReturnType<typeof computeMath>;

interface Props {
  analysis: Record<string, number | string | null> | null;
  math: Math;
  tags: TagRow[];
  driverRows: DriverRow[];
  threshold: number;
  setThreshold: (v: number) => void;
  flaggedCount: number;
}

/** Headline tiles, the confidence arithmetic and the low-confidence threshold control. */
const ConfidenceHeadline = ({
  analysis,
  math,
  tags,
  driverRows,
  threshold,
  setThreshold,
  flaggedCount,
}: Props) => (
  <>
    {/* headline */}
    <div className="mt-4 grid gap-3 sm:grid-cols-3">
      <div className="rounded-md border border-border p-3">
        <p className="text-xs text-muted-foreground">Recorded confidence</p>
        <p className="text-2xl font-semibold">{math ? math.confidence.toFixed(3) : "—"}</p>
        <Progress value={(math?.confidence ?? 0) * 100} className="mt-2 h-1.5" />
      </div>
      <div className="rounded-md border border-border p-3">
        <p className="text-xs text-muted-foreground">Dominant category</p>
        <div className="mt-1">
          {analysis?.category ? (
            <Badge>{String(analysis.category)}</Badge>
          ) : (
            <span className="text-sm text-muted-foreground">not scored</span>
          )}
        </div>

        <p className="mt-2 text-[11px] text-muted-foreground">
          {tags.length} taxonomy node{tags.length === 1 ? "" : "s"} ·{" "}
          {driverRows.length} driver row{driverRows.length === 1 ? "" : "s"}
        </p>
      </div>
      <div className="rounded-md border border-border p-3">
        <p className="text-xs text-muted-foreground">Evidence tier</p>
        <p className="text-lg font-semibold capitalize">{math?.tier.kind ?? "—"}</p>
        <p className="mt-1 text-[11px] text-muted-foreground">
          weight ×{math ? math.tier.factor.toFixed(1) : "—"} · {math?.tier.detail}
        </p>
      </div>
    </div>

    {/* math */}
    {math && (
      <div className="mt-4 rounded-md border border-border bg-muted/30 p-3">
        <p className="text-xs font-medium">How the number is computed</p>
        <p className="mt-1 font-mono text-[11px] leading-relaxed text-muted-foreground">
          scores = [{math.scores.map((s) => Math.round(s)).join(", ")}] · mean{" "}
          {math.mean.toFixed(1)} · stddev {math.stddev.toFixed(2)}
          <br />
          spread = clamp(stddev / 30, 0.1, 1) = {math.spread.toFixed(3)}
          <br />
          confidence = spread × evidence({math.tier.kind} = {math.tier.factor.toFixed(1)}) ={" "}
          {math.confidence.toFixed(3)}
        </p>
      </div>
    )}

    {/* low-confidence threshold */}
    <div className="mt-4 rounded-md border border-border bg-card/60 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <SlidersHorizontal className="h-4 w-4 text-primary" />
        <p className="text-xs font-medium">Low-confidence threshold</p>
        <span className="ml-auto font-mono text-xs">{threshold.toFixed(2)}</span>
      </div>
      <div className="mt-3 flex items-center gap-3">
        <Slider
          value={[threshold]}
          min={0.01}
          max={0.8}
          step={0.01}
          onValueChange={(v) => setThreshold(v[0])}
          className="flex-1"
          aria-label="Low-confidence threshold"
        />
        <Input
          type="number"
          min={0.01}
          max={0.8}
          step={0.01}
          value={threshold}
          onChange={(e) => {
            const v = Number(e.target.value);
            if (Number.isFinite(v)) setThreshold(Math.min(0.8, Math.max(0.01, v)));
          }}
          className="h-8 w-20 font-mono text-xs"
          aria-label="Low-confidence threshold value"
        />
        <Button size="sm" variant="ghost" onClick={() => setThreshold(0.15)}>
          Reset
        </Button>
      </div>
      <p className="mt-2 text-[11px] text-muted-foreground">
        A driver row is flagged when share × evidence factor (
        {math ? math.tier.factor.toFixed(1) : "—"}) falls below the threshold.{" "}
        <span className={flaggedCount ? "text-destructive" : "text-primary"}>
          {flaggedCount} of {driverRows.length} row{driverRows.length === 1 ? "" : "s"} flagged
        </span>
        {math && (
          <>
            {" · overall confidence "}
            <span className={math.confidence < threshold ? "text-destructive" : "text-primary"}>
              {math.confidence.toFixed(3)} {math.confidence < threshold ? "below" : "above"} threshold
            </span>
          </>
        )}
        .
      </p>
    </div>
  </>
);

export default ConfidenceHeadline;
