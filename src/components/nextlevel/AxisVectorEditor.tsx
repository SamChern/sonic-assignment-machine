import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { RESONANCE_AXES, type AxisVector, type ResonanceAxis } from "@/lib/nextlevel/resonance";

interface Props {
  title: string;
  value: AxisVector;
  onChange: (next: AxisVector) => void;
}

/** Six sliders, one per category — the shared input for every lab panel. */
export function AxisVectorEditor({ title, value, onChange }: Props) {
  return (
    <div className="space-y-3">
      <p className="text-sm font-medium text-foreground">{title}</p>
      {RESONANCE_AXES.map((axis: ResonanceAxis) => (
        <div key={axis} className="space-y-1">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <Label htmlFor={`${title}-${axis}`} className="capitalize">
              {axis}
            </Label>
            <span className="tabular-nums">{Math.round(value[axis] ?? 50)}</span>
          </div>
          <Slider
            id={`${title}-${axis}`}
            aria-label={`${title} ${axis} score`}
            min={0}
            max={100}
            step={1}
            value={[Math.round(value[axis] ?? 50)]}
            onValueChange={([v]) => onChange({ ...value, [axis]: v })}
          />
        </div>
      ))}
    </div>
  );
}
