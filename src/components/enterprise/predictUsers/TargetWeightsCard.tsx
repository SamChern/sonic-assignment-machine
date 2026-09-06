import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, Save, Sliders, Target, Users } from "lucide-react";
import { CATEGORY_KEYS } from "@/lib/enterpriseSchema";
import { categoryLabel } from "@/lib/categoryProfile";
import type { CategoryProfile, CategoryProfileConfig, MappedCategory } from "@/lib/categoryProfile";
import type { DatasetOption, Weights } from "./types";

interface TargetWeightsCardProps {
  config: CategoryProfileConfig;
  activeProfile: CategoryProfile | null;
  vector: number[] | null;
  seedOrigin: "brief" | "records" | null;
  pool: unknown[];
  target: Weights;
  setTarget: (updater: (prev: Weights) => Weights) => void;
  targetPreview: MappedCategory[];
  weights: Weights;
  setWeights: (updater: (prev: Weights) => Weights) => void;
  datasetId: string;
  setDatasetId: (id: string) => void;
  datasets: DatasetOption[];
  runMatch: () => void;
  matching: boolean;
  saveRun: () => void;
  canWrite: boolean;
  saving: boolean;
}

/** Target profile sliders plus the re-weighting controls (11b matching triggers). */
const TargetWeightsCard = ({
  config,
  activeProfile,
  vector,
  seedOrigin,
  pool,
  target,
  setTarget,
  targetPreview,
  weights,
  setWeights,
  datasetId,
  setDatasetId,
  datasets,
  runMatch,
  matching,
  saveRun,
  canWrite,
  saving,
}: TargetWeightsCardProps) => {
  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Target className="h-4 w-4 text-primary" />
        <h2 className="text-sm font-semibold">Predict SonicSIM-Users</h2>
        <Badge variant="outline" className="text-[11px]">{pool.length} people available</Badge>
        <Badge variant="outline" className="text-[11px]">
          <Sliders className="mr-1 h-3 w-3" />
          {activeProfile ? `calibration v${activeProfile.version}` : "SonicSIM defaults"}
        </Badge>
        {vector && (
          <Badge className="text-[11px]">
            started from {seedOrigin === "brief" ? "your description" : "example people"}
          </Badge>
        )}
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        These sliders set what matters most in the match, and each result is explained by the six
        qualities. Category names come from your organization&apos;s active version in the
        Categories tab.
      </p>

      <div className="mt-3 flex flex-wrap gap-2">
        <Select value={datasetId} onValueChange={setDatasetId}>
          <SelectTrigger className="w-[240px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All datasets</SelectItem>
            {datasets.map((d) => (
              <SelectItem key={d.id} value={d.id}>
                {d.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button size="sm" variant="outline" onClick={runMatch} disabled={matching}>
          {matching ? (
            <Loader2 className="mr-1 h-4 w-4 animate-spin" />
          ) : (
            <Users className="mr-1 h-4 w-4" />
          )}
          Find look-alikes
        </Button>
        <Button size="sm" onClick={saveRun} disabled={!canWrite || saving}>
          <Save className="mr-1 h-4 w-4" />
          Save run
        </Button>
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        {CATEGORY_KEYS.map((c) => {
          const mapped = targetPreview.find((p) => p.key === c);
          return (
            <div
              key={c}
              className={`rounded-lg border p-3 ${
                config[c].enabled ? "border-border/60" : "border-dashed border-border/50 opacity-70"
              }`}
            >
              <div className="flex items-center justify-between text-xs">
                <span className="font-medium">{categoryLabel(config, c)}</span>
                <span className="text-muted-foreground">target {target[c]}</span>
              </div>
              <Slider
                value={[target[c]]}
                min={0}
                max={100}
                step={1}
                disabled={!config[c].enabled}
                onValueChange={([v]) => setTarget((p) => ({ ...p, [c]: v }))}
                className="mt-2"
              />
              <div className="mt-2 flex items-center justify-between text-[11px] text-muted-foreground">
                <span>{config[c].enabled ? `maps to ${mapped?.mapped.toFixed(0)}` : "disabled"}</span>
                <span>weight {weights[c].toFixed(2)}</span>
              </div>
              <Slider
                value={[weights[c] * 100]}
                min={0}
                max={200}
                step={5}
                disabled={!config[c].enabled}
                onValueChange={([v]) => setWeights((p) => ({ ...p, [c]: v / 100 }))}
                className="mt-2"
              />
            </div>
          );
        })}
      </div>
    </Card>
  );
};

export default TargetWeightsCard;
