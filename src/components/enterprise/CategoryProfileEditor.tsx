import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/hooks/use-toast";
import { type CategoryKey } from "@/lib/enterpriseSchema";
import {
  defaultCategoryProfileConfig,
  compareCategoryProfiles,
  diffCategoryProfiles,
  mapProfileInput,
  summarizeProfileImpact,
  type CategoryProfileConfig,
} from "@/lib/categoryProfile";

import { useCategoryProfiles } from "@/hooks/useCategoryProfiles";

import { CalibrationCard } from "./categoryProfile/CalibrationCard";
import { VersionDiffCard } from "./categoryProfile/VersionDiffCard";
import { InputMappingPreview } from "./categoryProfile/InputMappingPreview";
import { SAMPLE_INPUT } from "./categoryProfile/types";

/**
 * Editor for an organization's 6 SonicSIM semantic categories. Saving always
 * creates a new numbered version (never overwrites history), and the live
 * preview shows exactly how an input score maps into each category and how
 * much influence it carries in Predict SonicSIM-Users matching.
 */
const CategoryProfileEditor = ({
  organizationId,
  canEdit,
  onSaved,
}: {
  organizationId: string;
  /** Only enterprise admins (organization owners) may change the 6 categories. */
  canEdit: boolean;
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

  // Multi-version compare: any number of calibrations, ordered oldest → newest
  // by the option list, each column flagged against the column before it.
  const [compareMode, setCompareMode] = useState<"two" | "multi">("two");
  const [multiIds, setMultiIds] = useState<string[]>([]);

  useEffect(() => {
    if (loading) return;
    const ordered = [...versions].sort((a, b) => a.version - b.version).map((v) => v.id);
    setMultiIds(ordered.length >= 2 ? ordered.slice(-3) : ["defaults", ...ordered, "draft"].slice(0, 3));
  }, [loading, versions]);

  const orderedMultiIds = useMemo(() => {
    const order = ["defaults", ...[...versions].sort((a, b) => a.version - b.version).map((v) => v.id), "draft"];
    return order.filter((id) => multiIds.includes(id));
  }, [multiIds, versions]);

  const toggleMultiId = (id: string) =>
    setMultiIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const multiRows = useMemo(
    () => compareCategoryProfiles(orderedMultiIds.map((id) => configFor(id))),
    [orderedMultiIds, configFor],
  );
  const multiChangedCount = multiRows.filter((r) => r.changed).length;

  /**
   * Impact endpoints: in two-way mode it is the chosen pair, in multi-version
   * mode the oldest → newest calibration in the selected timeline.
   */
  const impactEnds = useMemo(() => {
    if (compareMode === "two") return { from: leftId, to: rightId };
    if (orderedMultiIds.length < 2) return null;
    return { from: orderedMultiIds[0], to: orderedMultiIds[orderedMultiIds.length - 1] };
  }, [compareMode, leftId, rightId, orderedMultiIds]);

  const impact = useMemo(
    () => (impactEnds ? summarizeProfileImpact(configFor(impactEnds.from), configFor(impactEnds.to)) : null),
    [impactEnds, configFor],
  );




  const saveVersion = useCallback(
    async (activate: boolean) => {
      if (!canEdit) {
        toast({
          title: "Only enterprise admins can edit categories",
          description: "Your role has view-only access to this calibration.",
          variant: "destructive",
        });
        return;
      }
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
    [canEdit, name, notes, draft, enabledCount, nextVersion, organizationId, reload, onSaved],
  );

  const activateSelected = useCallback(async () => {
    if (!canEdit) return;

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
  }, [canEdit, selectedId, versions, organizationId, reload, onSaved]);

  if (loading) return <Skeleton className="h-64 w-full" />;

  return (
    <div className="space-y-4">
      <CalibrationCard
        versions={versions}
        activeProfile={activeProfile}
        canEdit={canEdit}
        selectedId={selectedId}
        selectVersion={selectVersion}
        draft={draft}
        setDraft={setDraft}
        patch={patch}
        name={name}
        setName={setName}
        notes={notes}
        setNotes={setNotes}
        saving={saving}
        nextVersion={nextVersion}
        saveVersion={saveVersion}
        activateSelected={activateSelected}
        defaultCategoryProfileConfig={defaultCategoryProfileConfig}
      />

      <VersionDiffCard
        compareMode={compareMode}
        setCompareMode={setCompareMode}
        changedRows={changedRows}
        multiChangedCount={multiChangedCount}
        sideOptions={sideOptions}
        multiIds={multiIds}
        toggleMultiId={toggleMultiId}
        orderedMultiIds={orderedMultiIds}
        sideLabel={sideLabel}
        multiRows={multiRows}
        leftId={leftId}
        setLeftId={setLeftId}
        rightId={rightId}
        setRightId={setRightId}
        diffRows={diffRows}
        impact={impact}
        impactEnds={impactEnds}
      />

      <InputMappingPreview
        preview={preview}
        enabledCount={enabledCount}
        sample={sample}
        setSample={setSample}
      />
    </div>
  );
};

export default CategoryProfileEditor;
