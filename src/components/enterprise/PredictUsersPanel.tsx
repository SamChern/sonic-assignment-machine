import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
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
import { useCategoryProfiles } from "@/hooks/useCategoryProfiles";
import { categoryLabel, mapProfileInput, profileSimilarity } from "@/lib/categoryProfile";
import { Save, Sliders, Target, Users } from "lucide-react";

interface RecordRow {
  id: string;
  external_user_id: string | null;
  source_name: string | null;
  dataset_id: string;
  emotional_score: number | null;
  cognitive_score: number | null;
  social_score: number | null;
  communication_score: number | null;
  contextual_score: number | null;
  artistic_score: number | null;
}

interface DatasetOption {
  id: string;
  name: string;
}

type Weights = Record<CategoryKey, number>;

const DEFAULT_WEIGHTS: Weights = {
  emotional: 1,
  cognitive: 1,
  social: 1,
  communication: 1,
  contextual: 1,
  artistic: 1,
};

const recordScores = (r: RecordRow) =>
  Object.fromEntries(
    CATEGORY_KEYS.map((c) => [
      c,
      Number((r as unknown as Record<string, number | null>)[`${c}_score`] ?? 0),
    ]),
  ) as Record<CategoryKey, number>;


/**
 * Predict SonicSIM-Users: pick a target semantic profile (a dataset average or
 * manual sliders), then rank the organization's records by how closely their
 * own 6-category profile matches it.
 */
const PredictUsersPanel = ({
  organizationId,
  canWrite,
}: {
  organizationId: string;
  canWrite: boolean;
}) => {
  const [datasets, setDatasets] = useState<DatasetOption[]>([]);
  const [datasetId, setDatasetId] = useState<string>("all");
  const [records, setRecords] = useState<RecordRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [target, setTarget] = useState<Weights>({
    emotional: 60,
    cognitive: 55,
    social: 55,
    communication: 50,
    contextual: 50,
    artistic: 60,
  });
  const [weights, setWeights] = useState<Weights>(DEFAULT_WEIGHTS);
  const [saving, setSaving] = useState(false);
  const { config, activeProfile } = useCategoryProfiles(organizationId);

  // Adopt the active organization calibration's weights as the starting point.
  useEffect(() => {
    setWeights(
      Object.fromEntries(CATEGORY_KEYS.map((c) => [c, config[c].weight])) as Weights,
    );
  }, [config]);

  /** Active calibration (labels + bias) with the panel's live weight overrides. */
  const effectiveConfig = useMemo(
    () =>
      Object.fromEntries(
        CATEGORY_KEYS.map((c) => [c, { ...config[c], weight: weights[c] }]),
      ) as typeof config,
    [config, weights],
  );

  const targetPreview = useMemo(
    () => mapProfileInput(effectiveConfig, target),
    [effectiveConfig, target],
  );


  const load = useCallback(async () => {
    setLoading(true);
    const [{ data: ds }, { data: recs }] = await Promise.all([
      supabase
        .from("enterprise_datasets")
        .select("id, name")
        .eq("organization_id", organizationId)
        .order("created_at", { ascending: false }),
      supabase
        .from("enterprise_records")
        .select(
          "id, external_user_id, source_name, dataset_id, emotional_score, cognitive_score, social_score, communication_score, contextual_score, artistic_score",
        )
        .eq("organization_id", organizationId)
        .eq("analysis_status", "scored")
        .limit(5000),
    ]);
    setDatasets((ds ?? []) as DatasetOption[]);
    setRecords((recs ?? []) as RecordRow[]);
    setLoading(false);
  }, [organizationId]);

  useEffect(() => {
    void load();
  }, [load]);

  const pool = useMemo(
    () => (datasetId === "all" ? records : records.filter((r) => r.dataset_id === datasetId)),
    [records, datasetId],
  );

  const matches = useMemo(
    () =>
      pool
        .map((r) => ({
          record: r,
          score: profileSimilarity(effectiveConfig, target, recordScores(r)),
        }))
        .sort((a, b) => b.score - a.score)
        .slice(0, 50),
    [pool, target, effectiveConfig],
  );


  const useDatasetAverage = useCallback(async () => {
    if (datasetId === "all") return;
    const { data } = await supabase
      .from("enterprise_datasets")
      .select(
        "emotional_avg, cognitive_avg, social_avg, communication_avg, contextual_avg, artistic_avg",
      )
      .eq("id", datasetId)
      .maybeSingle();
    if (!data) return;
    const next = { ...target };
    for (const c of CATEGORY_KEYS) {
      const v = Number((data as Record<string, number | null>)[`${c}_avg`] ?? 0);
      if (v) next[c] = Math.round(v);
    }
    setTarget(next);
  }, [datasetId, target]);

  const saveRun = useCallback(async () => {
    setSaving(true);
    const { error } = await supabase.from("prediction_runs").insert({
      organization_id: organizationId,
      kind: "users",
      params: { dataset_id: datasetId, target },
      weights,
      result: {
        matched: matches.length,
        top: matches.slice(0, 25).map((m) => ({
          record_id: m.record.id,
          label: m.record.external_user_id ?? m.record.source_name,
          score: m.score,
        })),
      },
      status: "complete",
    });
    setSaving(false);
    if (error) {
      toast({ title: "Could not save", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Look-alike run saved", description: `${matches.length} matches recorded.` });
  }, [organizationId, datasetId, target, weights, matches]);

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <div className="flex flex-wrap items-center gap-2">
          <Target className="h-4 w-4 text-primary" />
          <h2 className="text-sm font-semibold">Predict SonicSIM-Users</h2>
          <Badge variant="outline" className="text-[11px]">{pool.length} scored records</Badge>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          Set the semantic profile you want to reach, then adjust how much each category matters.
          SonicSIM ranks your records by weighted closeness to that profile.
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
          <Button
            variant="outline"
            size="sm"
            onClick={useDatasetAverage}
            disabled={datasetId === "all"}
          >
            Use dataset average as target
          </Button>
          <Button size="sm" onClick={saveRun} disabled={!canWrite || saving || !matches.length}>
            <Save className="mr-1 h-4 w-4" />
            Save run
          </Button>
        </div>

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          {CATEGORY_KEYS.map((c) => (
            <div key={c} className="rounded-lg border border-border/60 p-3">
              <div className="flex items-center justify-between text-xs">
                <span className="font-medium capitalize">{c}</span>
                <span className="text-muted-foreground">target {target[c]}</span>
              </div>
              <Slider
                value={[target[c]]}
                min={0}
                max={100}
                step={1}
                onValueChange={([v]) => setTarget((p) => ({ ...p, [c]: v }))}
                className="mt-2"
              />
              <div className="mt-2 flex items-center justify-between text-[11px] text-muted-foreground">
                <span>importance</span>
                <span>×{weights[c].toFixed(1)}</span>
              </div>
              <Slider
                value={[weights[c]]}
                min={0}
                max={3}
                step={0.1}
                onValueChange={([v]) => setWeights((p) => ({ ...p, [c]: v }))}
                className="mt-1"
              />
            </div>
          ))}
        </div>
      </Card>

      {loading ? (
        <Skeleton className="h-40 w-full" />
      ) : !matches.length ? (
        <Card className="p-6 text-center text-xs text-muted-foreground">
          No scored records yet — upload a dataset and run semantic scoring first.
        </Card>
      ) : (
        <Card className="p-4">
          <div className="flex items-center gap-2">
            <Users className="h-4 w-4 text-primary" />
            <h3 className="text-sm font-semibold">Top look-alikes</h3>
          </div>
          <div className="mt-3 space-y-1">
            {matches.slice(0, 25).map((m, i) => (
              <div
                key={m.record.id}
                className="flex items-center gap-2 rounded-lg border border-border/50 bg-muted/10 p-2"
              >
                <span className="w-6 text-xs text-muted-foreground">{i + 1}</span>
                <span className="min-w-0 flex-1 truncate text-xs">
                  {m.record.external_user_id ?? m.record.source_name ?? m.record.id.slice(0, 8)}
                </span>
                <div className="hidden h-1.5 w-32 overflow-hidden rounded bg-muted sm:block">
                  <div className="h-full bg-primary" style={{ width: `${m.score}%` }} />
                </div>
                <span className="w-12 text-right text-xs font-medium">{m.score.toFixed(0)}%</span>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
};

export default PredictUsersPanel;
