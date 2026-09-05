import { Card } from "@/components/ui/card";
import { Slider } from "@/components/ui/slider";

interface RunSettingsCardProps {
  maxObjects: number;
  setMaxObjects: (v: number) => void;
  maxRows: number;
  setMaxRows: (v: number) => void;
}

export const RunSettingsCard = ({ maxObjects, setMaxObjects, maxRows, setMaxRows }: RunSettingsCardProps) => (
  <Card className="border-border/60 bg-card/60 p-5 backdrop-blur-sm">
    <div className="grid gap-6 sm:grid-cols-2">
      <div className="space-y-2">
        <div className="flex items-center justify-between text-sm">
          <span className="font-medium">Objects probed per run</span>
          <span className="text-muted-foreground">{maxObjects}</span>
        </div>
        <Slider
          value={[maxObjects]}
          min={1}
          max={8}
          step={1}
          onValueChange={([v]) => setMaxObjects(v)}
        />
      </div>
      <div className="space-y-2">
        <div className="flex items-center justify-between text-sm">
          <span className="font-medium">Rows sampled per object</span>
          <span className="text-muted-foreground">{maxRows}</span>
        </div>
        <Slider
          value={[maxRows]}
          min={20}
          max={2000}
          step={20}
          onValueChange={([v]) => setMaxRows(v)}
        />
      </div>
    </div>
  </Card>
);
