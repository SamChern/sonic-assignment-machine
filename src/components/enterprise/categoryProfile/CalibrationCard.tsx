import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CATEGORY_KEYS, type CategoryKey } from "@/lib/enterpriseSchema";
import { DEFAULT_CATEGORY_LABELS, type CategoryProfileConfig } from "@/lib/categoryProfile";
import type { CategoryProfile } from "@/lib/categoryProfile";
import {
  CheckCircle2,
  GitBranch,
  Lock,
  RotateCcw,
  Save,
  Sliders,
  Unlock,
} from "lucide-react";

export const CalibrationCard = ({
  versions,
  activeProfile,
  canEdit,
  selectedId,
  selectVersion,
  draft,
  setDraft,
  patch,
  name,
  setName,
  notes,
  setNotes,
  saving,
  nextVersion,
  saveVersion,
  activateSelected,
  defaultCategoryProfileConfig,
}: {
  versions: CategoryProfile[];
  activeProfile: CategoryProfile | null;
  canEdit: boolean;
  selectedId: string;
  selectVersion: (id: string) => void;
  draft: CategoryProfileConfig;
  setDraft: (c: CategoryProfileConfig) => void;
  patch: (c: CategoryKey, next: Partial<CategoryProfileConfig[CategoryKey]>) => void;
  name: string;
  setName: (v: string) => void;
  notes: string;
  setNotes: (v: string) => void;
  saving: boolean;
  nextVersion: number;
  saveVersion: (activate: boolean) => void;
  activateSelected: () => void;
  defaultCategoryProfileConfig: () => CategoryProfileConfig;
}) => {
  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Sliders className="h-4 w-4 text-primary" />
        <h2 className="text-sm font-semibold">Semantic category editor</h2>
        <Badge variant="outline" className="text-[11px]">
          {versions.length} version{versions.length === 1 ? "" : "s"}
        </Badge>
        {activeProfile && (
          <Badge className="text-[11px]">active: v{activeProfile.version}</Badge>
        )}
        <Badge variant={canEdit ? "secondary" : "outline"} className="text-[11px]">
          {canEdit ? (
            <>
              <Unlock className="mr-1 h-3 w-3" />
              Admin — editing unlocked
            </>
          ) : (
            <>
              <Lock className="mr-1 h-3 w-3" />
              View only
            </>
          )}
        </Badge>

      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        Rename, re-weight, calibrate, or mute any of the 6 categories for {""}
        your organization. Stored scores never change — this is a mapping layer, and every save
        becomes a new numbered version you can return to.
      </p>

      <div className="mt-3 flex flex-wrap gap-2">
        <Select value={selectedId || undefined} onValueChange={selectVersion}>
          <SelectTrigger className="w-[260px]">
            <SelectValue placeholder="Start from defaults" />
          </SelectTrigger>
          <SelectContent>
            {versions.map((v) => (
              <SelectItem key={v.id} value={v.id}>
                v{v.version} · {v.name}
                {v.is_active ? " (active)" : ""}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setDraft(defaultCategoryProfileConfig())}
          disabled={!canEdit}
        >
          <RotateCcw className="mr-1 h-4 w-4" />
          Reset to SonicSIM defaults
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={activateSelected}
          disabled={!canEdit || saving || !selectedId || !!versions.find((v) => v.id === selectedId)?.is_active}
        >
          <CheckCircle2 className="mr-1 h-4 w-4" />
          Activate selected version
        </Button>
      </div>

      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          disabled={!canEdit}
          placeholder="Version name (e.g. Spoken-word calibration)"
        />
        <Textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          disabled={!canEdit}
          rows={2}
          placeholder="What changed and why (optional)"
          className="text-xs"
        />
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        {CATEGORY_KEYS.map((c) => (
          <div
            key={c}
            className={`rounded-lg border p-3 ${
              draft[c].enabled ? "border-border/60" : "border-dashed border-border/50 opacity-70"
            }`}
          >
            <div className="flex items-center gap-2">
              <Input
                value={draft[c].label}
                onChange={(e) => patch(c, { label: e.target.value })}
                disabled={!canEdit}
                className="h-8 text-xs"
                placeholder={DEFAULT_CATEGORY_LABELS[c]}
              />
              <Switch
                checked={draft[c].enabled}
                onCheckedChange={(v) => patch(c, { enabled: v })}
                disabled={!canEdit}
              />
            </div>
            <p className="mt-1 text-[11px] text-muted-foreground">
              maps SonicSIM <span className="font-mono">{c}</span>
            </p>

            <div className="mt-2 flex items-center justify-between text-[11px] text-muted-foreground">
              <span>weight</span>
              <span>×{draft[c].weight.toFixed(1)}</span>
            </div>
            <Slider
              value={[draft[c].weight]}
              min={0}
              max={3}
              step={0.1}
              disabled={!canEdit || !draft[c].enabled}
              onValueChange={([v]) => patch(c, { weight: v })}
              className="mt-1"
            />

            <div className="mt-2 flex items-center justify-between text-[11px] text-muted-foreground">
              <span>calibration shift</span>
              <span>
                {draft[c].bias > 0 ? "+" : ""}
                {draft[c].bias.toFixed(0)} pts
              </span>
            </div>
            <Slider
              value={[draft[c].bias]}
              min={-25}
              max={25}
              step={1}
              disabled={!canEdit || !draft[c].enabled}
              onValueChange={([v]) => patch(c, { bias: v })}
              className="mt-1"
            />
          </div>
        ))}
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <Button size="sm" onClick={() => saveVersion(true)} disabled={!canEdit || saving}>
          <Save className="mr-1 h-4 w-4" />
          Save as v{nextVersion} &amp; activate
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => saveVersion(false)}
          disabled={!canEdit || saving}
        >
          <GitBranch className="mr-1 h-4 w-4" />
          Save as draft version
        </Button>
        {!canEdit && (
          <span className="self-center text-[11px] text-muted-foreground">
            Locked — only enterprise admins (organization owners) can change the 6 categories.
          </span>
        )}
      </div>
    </Card>
  );
};
