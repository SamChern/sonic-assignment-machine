import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "@/hooks/use-toast";
import { CATEGORY_KEYS, type CategoryKey } from "@/lib/enterpriseSchema";
import {
  DEFAULT_CATEGORY_LABELS,
  defaultCategoryProfileConfig,
  diffCategoryProfiles,
  mapProfileInput,
  type CategoryProfileConfig,
} from "@/lib/categoryProfile";
import { useCategoryProfiles } from "@/hooks/useCategoryProfiles";
import {
  ArrowRight,
  CheckCircle2,
  GitBranch,
  GitCompare,
  RotateCcw,
  Save,
  Sliders,
  Wand2,
} from "lucide-react";

const SAMPLE_INPUT: Record<CategoryKey, number> = {
  emotional: 72,
  cognitive: 54,
  social: 61,
  communication: 78,
  contextual: 47,
  artistic: 66,
};

/**
 * Editor for an organization's 6 SonicSIM semantic categories. Saving always
 * creates a new numbered version (never overwrites history), and the live
 * preview shows exactly how an input score maps into each category and how
 * much influence it carries in Predict SonicSIM-Users matching.
 */
const CategoryProfileEditor = ({
  organizationId,
  canWrite,
  onSaved,
}: {
  organizationId: string;
  canWrite: boolean;
  onSaved?: () => void;
}) => {
  const { versions, activeProfile, loading, reload } = useCategoryProfiles(organizationId);
  const [selectedId, setSelectedId] = useState<string>("");
  const [draft, setDraft] = useState<CategoryProfileConfig>(defaultCategoryProfileConfig());
  const [name, setName] = useState("Baseline calibration");
  const [notes, setNotes] = useState("");
  const [sample, setSample] = useState<Record<CategoryKey, number>>(SAMPLE_INPUT);
  const [saving, setSaving] = useState(false);

  // Seed the draft from the active version (or defaults) once versions arrive.
  useEffect(() => {
    if (loading) return;
    const base = activeProfile ?? versions[0] ?? null;
    setSelectedId(base?.id ?? "");
    setDraft(base ? { ...base.config } : defaultCategoryProfileConfig());
    setName(base ? `${base.name}` : "Baseline calibration");
    setNotes(base?.notes ?? "");
  }, [loading, activeProfile, versions]);

  const selectVersion = useCallback(
    (id: string) => {
      const v = versions.find((x) => x.id === id);
      if (!v) return;
      setSelectedId(id);
      setDraft({ ...v.config });
      setName(v.name);
      setNotes(v.notes ?? "");
    },
    [versions],
  );

  const patch = (c: CategoryKey, next: Partial<CategoryProfileConfig[CategoryKey]>) =>
    setDraft((prev) => ({ ...prev, [c]: { ...prev[c], ...next } }));

  const nextVersion = useMemo(
    () => (versions.length ? Math.max(...versions.map((v) => v.version)) + 1 : 1),
    [versions],
  );

  const preview = useMemo(() => mapProfileInput(draft, sample), [draft, sample]);
  const enabledCount = preview.filter((p) => p.enabled).length;

  // Side-by-side comparison. "draft" is the unsaved editor state, "defaults" the
  // built-in SonicSIM calibration; anything else is a saved version id.
  const [leftId, setLeftId] = useState<string>("defaults");
  const [rightId, setRightId] = useState<string>("draft");

  useEffect(() => {
    if (loading) return;
    const prior = versions.find((v) => v.id !== selectedId) ?? versions[0];
    setLeftId(prior ? prior.id : "defaults");
  }, [loading, versions, selectedId]);

  const configFor = useCallback(
    (id: string): CategoryProfileConfig => {
      if (id === "draft") return draft;
      if (id === "defaults") return defaultCategoryProfileConfig();
      return versions.find((v) => v.id === id)?.config ?? defaultCategoryProfileConfig();
    },
    [draft, versions],
  );

  const sideLabel = useCallback(
    (id: string) => {
      if (id === "draft") return "Current draft (unsaved)";
      if (id === "defaults") return "SonicSIM defaults";
      const v = versions.find((x) => x.id === id);
      return v ? `v${v.version} · ${v.name}` : "Unknown version";
    },
    [versions],
  );

  const diffRows = useMemo(
    () => diffCategoryProfiles(configFor(leftId), configFor(rightId)),
    [configFor, leftId, rightId],
  );
  const changedRows = diffRows.filter((r) => r.changed);

  const sideOptions = useMemo(
    () => [
      { id: "draft", label: "Current draft (unsaved)" },
      ...versions.map((v) => ({
        id: v.id,
        label: `v${v.version} · ${v.name}${v.is_active ? " (active)" : ""}`,
      })),
      { id: "defaults", label: "SonicSIM defaults" },
    ],
    [versions],
  );


  const saveVersion = useCallback(
    async (activate: boolean) => {
      if (!name.trim()) {
        toast({ title: "Name this version first", variant: "destructive" });
        return;
      }
      if (!enabledCount) {
        toast({
          title: "Keep at least one category on",
          description: "Matching needs one active category.",
          variant: "destructive",
        });
        return;
      }
      setSaving(true);
      const { data: auth } = await supabase.auth.getUser();
      if (activate) {
        await supabase
          .from("org_category_profiles")
          .update({ is_active: false })
          .eq("organization_id", organizationId)
          .eq("is_active", true);
      }
      const { error } = await supabase.from("org_category_profiles").insert({
        organization_id: organizationId,
        version: nextVersion,
        name: name.trim(),
        notes: notes.trim() || null,
        config: draft as never,
        is_active: activate,
        created_by: auth.user?.id ?? null,
      });
      setSaving(false);
      if (error) {
        toast({ title: "Could not save version", description: error.message, variant: "destructive" });
        return;
      }
      toast({
        title: `Version ${nextVersion} saved`,
        description: activate ? "It is now the active calibration." : "Saved as a draft version.",
      });
      await reload();
      onSaved?.();
    },
    [name, notes, draft, enabledCount, nextVersion, organizationId, reload, onSaved],
  );

  const activateSelected = useCallback(async () => {
    const v = versions.find((x) => x.id === selectedId);
    if (!v) return;
    setSaving(true);
    await supabase
      .from("org_category_profiles")
      .update({ is_active: false })
      .eq("organization_id", organizationId)
      .eq("is_active", true);
    const { error } = await supabase
      .from("org_category_profiles")
      .update({ is_active: true })
      .eq("id", v.id);
    setSaving(false);
    if (error) {
      toast({ title: "Could not activate", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: `Version ${v.version} activated` });
    await reload();
    onSaved?.();
  }, [selectedId, versions, organizationId, reload, onSaved]);

  if (loading) return <Skeleton className="h-64 w-full" />;

  return (
    <div className="space-y-4">
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
          >
            <RotateCcw className="mr-1 h-4 w-4" />
            Reset to SonicSIM defaults
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={activateSelected}
            disabled={!canWrite || saving || !selectedId || !!versions.find((v) => v.id === selectedId)?.is_active}
          >
            <CheckCircle2 className="mr-1 h-4 w-4" />
            Activate selected version
          </Button>
        </div>

        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Version name (e.g. Spoken-word calibration)"
          />
          <Textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
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
                  className="h-8 text-xs"
                  placeholder={DEFAULT_CATEGORY_LABELS[c]}
                />
                <Switch
                  checked={draft[c].enabled}
                  onCheckedChange={(v) => patch(c, { enabled: v })}
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
                disabled={!draft[c].enabled}
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
                disabled={!draft[c].enabled}
                onValueChange={([v]) => patch(c, { bias: v })}
                className="mt-1"
              />
            </div>
          ))}
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <Button size="sm" onClick={() => saveVersion(true)} disabled={!canWrite || saving}>
            <Save className="mr-1 h-4 w-4" />
            Save as v{nextVersion} &amp; activate
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => saveVersion(false)}
            disabled={!canWrite || saving}
          >
            <GitBranch className="mr-1 h-4 w-4" />
            Save as draft version
          </Button>
          {!canWrite && (
            <span className="self-center text-[11px] text-muted-foreground">
              View-only role — ask an owner or analyst to save changes.
            </span>
          )}
        </div>
      </Card>

      <Card className="p-4">
        <div className="flex flex-wrap items-center gap-2">
          <GitCompare className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-semibold">Version diff</h3>
          <Badge variant="outline" className="text-[11px]">
            {changedRows.length} of 6 categories changed
          </Badge>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          Compare any two calibrations side by side — renamed categories, weight and match-influence
          shifts, calibration offsets, and anything muted or re-enabled.
        </p>

        <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_auto_1fr] sm:items-center">
          <Select value={leftId} onValueChange={setLeftId}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {sideOptions.map((o) => (
                <SelectItem key={`l-${o.id}`} value={o.id}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <ArrowRight className="mx-auto hidden h-4 w-4 text-muted-foreground sm:block" />
          <Select value={rightId} onValueChange={setRightId}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {sideOptions.map((o) => (
                <SelectItem key={`r-${o.id}`} value={o.id}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {!changedRows.length ? (
          <p className="mt-4 rounded-lg border border-dashed border-border/60 p-4 text-center text-xs text-muted-foreground">
            {sideLabel(leftId)} and {sideLabel(rightId)} are identical across all 6 categories.
          </p>
        ) : (
          <div className="mt-4 space-y-2">
            <div className="hidden grid-cols-[1fr_1fr_1fr] gap-2 px-2 text-[11px] font-medium text-muted-foreground sm:grid">
              <span>Category</span>
              <span className="truncate">{sideLabel(leftId)}</span>
              <span className="truncate">{sideLabel(rightId)}</span>
            </div>
            {diffRows.map((r) => (
              <div
                key={r.key}
                className={`rounded-lg border p-3 ${
                  r.changed ? "border-primary/40 bg-primary/5" : "border-border/40 bg-muted/10"
                }`}
              >
                <div className="grid gap-2 sm:grid-cols-[1fr_1fr_1fr]">
                  <div className="min-w-0">
                    <p className="text-xs font-medium">{r.right.label}</p>
                    <p className="font-mono text-[11px] text-muted-foreground">{r.key}</p>
                    {!r.changed && (
                      <span className="text-[11px] text-muted-foreground">unchanged</span>
                    )}
                  </div>

                  {(["left", "right"] as const).map((side) => {
                    const s = side === "left" ? r.left : r.right;
                    const influence = side === "left" ? r.leftInfluence : r.rightInfluence;
                    return (
                      <div key={side} className="space-y-1 text-[11px]">
                        <p className="sm:hidden text-muted-foreground">
                          {sideLabel(side === "left" ? leftId : rightId)}
                        </p>
                        <p className={r.labelChanged ? "font-medium text-primary" : ""}>
                          name: {s.label}
                        </p>
                        <p className={r.weightChanged ? "font-medium text-primary" : ""}>
                          weight ×{s.weight.toFixed(1)} · {(influence * 100).toFixed(0)}% of match
                        </p>
                        <p className={r.biasChanged ? "font-medium text-primary" : ""}>
                          shift {s.bias > 0 ? "+" : ""}
                          {s.bias.toFixed(0)} pts
                        </p>
                        <p className={r.enabledChanged ? "font-medium text-primary" : ""}>
                          {s.enabled ? "active" : "muted"}
                        </p>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

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
    </div>
  );
};

export default CategoryProfileEditor;
