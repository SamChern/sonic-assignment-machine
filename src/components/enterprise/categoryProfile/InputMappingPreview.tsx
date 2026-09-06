import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Slider } from "@/components/ui/slider";
import { Wand2 } from "lucide-react";
import type { CategoryKey } from "@/lib/enterpriseSchema";
import type { mapProfileInput } from "@/lib/categoryProfile";

export const InputMappingPreview = ({
  preview,
  enabledCount,
  sample,
  setSample,
}: {
  preview: ReturnType<typeof mapProfileInput>;
  enabledCount: number;
  sample: Record<CategoryKey, number>;
  setSample: (updater: (prev: Record<CategoryKey, number>) => Record<CategoryKey, number>) => void;
}) => {
  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Wand2 className="h-4 w-4 text-primary" />
        <h3 className="text-sm font-semibold">Input mapping preview</h3>
        <Badge variant="outline" className="text-[11px]">
          {enabledCount}/6 categories active
        </Badge>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        Move a sample input score to see the value each category receives after calibration, and
        the share of influence it carries when Predict SonicSIM-Users ranks look-alikes.
      </p>

      <div className="mt-3 space-y-3">
        {preview.map((p) => (
          <div key={p.key} className="rounded-lg border border-border/50 bg-muted/10 p-3">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="font-medium">{p.label}</span>
              {!p.enabled && (
                <Badge variant="outline" className="text-[10px]">muted</Badge>
              )}
              <span className="ml-auto text-muted-foreground">
                input {p.raw} → mapped {p.mapped.toFixed(0)}
                {p.delta !== 0 && (
                  <span className="ml-1 text-primary">
                    ({p.delta > 0 ? "+" : ""}
                    {p.delta.toFixed(0)})
                  </span>
                )}
              </span>
            </div>
            <Slider
              value={[sample[p.key]]}
              min={0}
              max={100}
              step={1}
              onValueChange={([v]) => setSample((prev) => ({ ...prev, [p.key]: v }))}
              className="mt-2"
            />
            <div className="mt-2 flex items-center gap-2">
              <div className="h-1.5 flex-1 overflow-hidden rounded bg-muted">
                <div
                  className="h-full bg-primary"
                  style={{ width: `${Math.round(p.influence * 100)}%` }}
                />
              </div>
              <span className="w-28 text-right text-[11px] text-muted-foreground">
                {(p.influence * 100).toFixed(0)}% of match weight
              </span>
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
};
