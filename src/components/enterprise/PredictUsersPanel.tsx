import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import { toast } from "@/hooks/use-toast";
import { CATEGORY_KEYS, type CategoryKey } from "@/lib/enterpriseSchema";
import { useCategoryProfiles } from "@/hooks/useCategoryProfiles";
import { categoryLabel, mapProfileInput, profileSimilarity } from "@/lib/categoryProfile";
import {
  Loader2,
  Save,
  Sliders,
  Sparkles,
  Target,
  Users,
  Wand2,
  X,
} from "lucide-react";

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

interface SeedTag {
  id: string;
  code: string;
  label: string;
  similarity: number;
}

interface KnnMatch {
  key: string;
  label: string;
  knn_similarity: number;
  axis_fit: number;
  score: number;
  scores: Record<CategoryKey, number>;
}

interface CurvePoint {
  threshold: number;
  matched: number;
  low: number;
  high: number;
  mean_similarity: number;
}

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
 * Predict SonicSIM-Users.
 *
 * Profiles start from evidence: a brand brief embedded into the shared space, or
 * a centroid of exemplar records — the six sliders refine that proposal instead
 * of originating it. Matching runs as kNN over the embedding store and the
 * sliders re-weight the ranked neighbours, with the six axes serving as the
 * explanation layer. The reach–resonance curve turns the similarity floor into
 * the reach tradeoff a planner actually negotiates, and saving a point writes a
 * sonic cohort — the front door to the activation lane.
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

  // 11a — seeding state
  const [brief, setBrief] = useState("");
  const [seeding, setSeeding] = useState(false);
  const [tags, setTags] = useState<SeedTag[]>([]);
  const [vector, setVector] = useState<number[] | null>(null);
  const [seedOrigin, setSeedOrigin] = useState<"brief" | "records" | null>(null);
  const [seedIds, setSeedIds] = useState<string[]>([]);

  // 11b — kNN state
  const [matching, setMatching] = useState(false);
  const [knn, setKnn] = useState<KnnMatch[] | null>(null);
  const [curve, setCurve] = useState<CurvePoint[]>([]);
  const [threshold, setThreshold] = useState(0.6);
  const [retrieved, setRetrieved] = useState(0);

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

  /** Local 6-axis fallback ranking, used until a kNN base exists. */
  const localMatches = useMemo(
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

  const call = useCallback(
    async (body: Record<string, unknown>) => {
      const { data, error } = await supabase.functions.invoke("predict-users", {
        body: { organization_id: organizationId, ...body },
      });
      if (error) throw new Error(error.message);
      if (!data?.success) throw new Error(data?.error ?? "Request failed");
      return data as Record<string, unknown>;
    },
    [organizationId],
  );

  /* ------------------------------------------------------------ 11a seeding */

  const proposeFromBrief = useCallback(async () => {
    setSeeding(true);
    try {
      const data = await call({ action: "brief", brief });
      setTarget((prev) => ({ ...prev, ...(data.target as Weights) }));
      setTags((data.tags as SeedTag[]) ?? []);
      setVector((data.vector as number[]) ?? null);
      setSeedOrigin("brief");
      toast({
        title: "Profile proposed",
        description: `${((data.tags as SeedTag[]) ?? []).length} taxonomy tags contributed. Refine with the sliders.`,
      });
    } catch (e) {
      toast({ title: "Could not read the brief", description: (e as Error).message, variant: "destructive" });
    } finally {
      setSeeding(false);
    }
  }, [brief, call]);

  const seedFromRecords = useCallback(async () => {
    setSeeding(true);
    try {
      const data = await call({ action: "seed", record_ids: seedIds });
      setTarget((prev) => ({ ...prev, ...(data.target as Weights) }));
      setVector((data.vector as number[]) ?? null);
      setTags([]);
      setSeedOrigin("records");
      toast({
        title: "Seeded from exemplars",
        description: `Centroid of ${data.seeded_from} records is now the target.`,
      });
    } catch (e) {
      toast({ title: "Could not seed", description: (e as Error).message, variant: "destructive" });
    } finally {
      setSeeding(false);
    }
  }, [seedIds, call]);

  const toggleSeed = (id: string) =>
    setSeedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : prev.length >= 10 ? prev : [...prev, id],
    );

  const dropTag = (id: string) => setTags((prev) => prev.filter((t) => t.id !== id));

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

  /* --------------------------------------------------------- 11b kNN matching */

  const runMatch = useCallback(async () => {
    setMatching(true);
    try {
      const data = await call({ action: "match", vector, target, weights });
      setKnn((data.matches as KnnMatch[]) ?? []);
      setCurve((data.curve as CurvePoint[]) ?? []);
      setRetrieved(Number(data.retrieved ?? 0));
      if (typeof data.default_threshold === "number") {
        setThreshold(Number(data.default_threshold));
      }
    } catch (e) {
      toast({ title: "Matching failed", description: (e as Error).message, variant: "destructive" });
    } finally {
      setMatching(false);
    }
  }, [call, vector, target, weights]);

  // Re-weighting is instant: the retrieved neighbours are re-scored locally so
  // the sliders never change the retrieval base, only the ranking.
  const reweighted = useMemo(() => {
    if (!knn) return null;
    const wSum = CATEGORY_KEYS.reduce((s, c) => s + Math.max(0, weights[c]), 0) || 1;
    return knn
      .map((m) => {
        let dist = 0;
        for (const c of CATEGORY_KEYS) {
          dist += (Math.max(0, weights[c]) / wSum) * Math.abs((m.scores[c] ?? 0) - target[c]) / 100;
        }
        const axisFit = Math.max(0, Math.min(1, 1 - dist));
        return { ...m, axis_fit: axisFit, score: 0.65 * m.knn_similarity + 0.35 * axisFit };
      })
      .sort((a, b) => b.score - a.score);
  }, [knn, weights, target]);

  const atThreshold = useMemo(
    () => (reweighted ?? []).filter((m) => m.knn_similarity >= threshold),
    [reweighted, threshold],
  );

  /* ------------------------------------------------------------------- saving */

  const saveRun = useCallback(async () => {
    setSaving(true);
    try {
      if (reweighted && atThreshold.length) {
        const data = await call({
          action: "save_cohort",
          vector,
          threshold,
          target,
          weights,
          brief: seedOrigin === "brief" ? brief : null,
          name: brief.trim() ? brief.trim().slice(0, 80) : "Predicted look-alikes",
          member_keys: atThreshold.map((m) => m.key),
        });
        toast({
          title: "Cohort saved",
          description: `${data.exposed} exposed · ${data.holdout} held out for lift · ${
            data.export_eligible ? "export eligible" : "below the 1,000 export minimum"
          }.`,
        });
      } else {
        const { error } = await supabase.from("prediction_runs").insert({
          organization_id: organizationId,
          kind: "users",
          params: {
            dataset_id: datasetId,
            target,
            category_profile_id: activeProfile?.id ?? null,
            category_profile_version: activeProfile?.version ?? null,
          },
          weights,
          result: {
            matched: localMatches.length,
            top: localMatches.slice(0, 25).map((m) => ({
              record_id: m.record.id,
              label: m.record.external_user_id ?? m.record.source_name,
              score: m.score,
            })),
          },
          status: "complete",
        });
        if (error) throw new Error(error.message);
        toast({
          title: "Look-alike run saved",
          description: `${localMatches.length} matches recorded.`,
        });
      }
    } catch (e) {
      toast({ title: "Could not save", description: (e as Error).message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }, [
    reweighted,
    atThreshold,
    call,
    vector,
    threshold,
    target,
    weights,
    brief,
    seedOrigin,
    organizationId,
    datasetId,
    activeProfile,
    localMatches,
  ]);

  return (
    <div className="space-y-4">
      {/* ------------------------------------------------ 11a: seed the profile */}
      <Card className="p-4">
        <div className="flex flex-wrap items-center gap-2">
          <Wand2 className="h-4 w-4 text-primary" />
          <h2 className="text-sm font-semibold">Describe your audience</h2>
          <Badge variant="outline" className="text-[11px]">evidence-seeded</Badge>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          Write the brief in your own words. SonicSIM embeds it into the same space as every scored
          audio profile and proposes a six-axis target plus the taxonomy tags that contributed —
          the sliders below then refine that proposal instead of guessing it.
        </p>
        <Textarea
          value={brief}
          onChange={(e) => setBrief(e.target.value)}
          rows={3}
          className="mt-3 text-xs"
          placeholder="e.g. late-night true-crime listeners who take morning fitness classes"
        />
        <div className="mt-2 flex flex-wrap gap-2">
          <Button size="sm" onClick={proposeFromBrief} disabled={seeding || brief.trim().length < 8}>
            {seeding ? (
              <Loader2 className="mr-1 h-4 w-4 animate-spin" />
            ) : (
              <Sparkles className="mr-1 h-4 w-4" />
            )}
            Propose profile
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={seedFromRecords}
            disabled={seeding || seedIds.length < 3}
          >
            Use {seedIds.length || 0} selected records as seed
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={useDatasetAverage}
            disabled={datasetId === "all"}
          >
            Use dataset average
          </Button>
        </div>

        {tags.length > 0 && (
          <div className="mt-3">
            <p className="text-[11px] font-medium text-muted-foreground">
              Top contributing taxonomy tags — remove any that do not belong
            </p>
            <div className="mt-2 flex flex-wrap gap-1">
              {tags.map((t) => (
                <Badge key={t.id} variant="secondary" className="gap-1 text-[11px]">
                  {t.label}
                  <span className="text-muted-foreground">{(t.similarity * 100).toFixed(0)}%</span>
                  <button
                    type="button"
                    aria-label={`Remove ${t.label}`}
                    onClick={() => dropTag(t.id)}
                    className="ml-1 rounded-sm hover:text-destructive"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </Badge>
              ))}
            </div>
          </div>
        )}
      </Card>

      {/* ------------------------------------------------ target + re-weighting */}
      <Card className="p-4">
        <div className="flex flex-wrap items-center gap-2">
          <Target className="h-4 w-4 text-primary" />
          <h2 className="text-sm font-semibold">Predict SonicSIM-Users</h2>
          <Badge variant="outline" className="text-[11px]">{pool.length} scored records</Badge>
          <Badge variant="outline" className="text-[11px]">
            <Sliders className="mr-1 h-3 w-3" />
            {activeProfile ? `calibration v${activeProfile.version}` : "SonicSIM defaults"}
          </Badge>
          {vector && (
            <Badge className="text-[11px]">
              seeded from {seedOrigin === "brief" ? "brief" : "exemplars"}
            </Badge>
          )}
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          Matching runs in the full embedding space; these sliders re-weight the ranked neighbours
          and explain the result in six axes. Category names and calibration shifts come from your
          organization&apos;s active version in the Categories tab.
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

      {/* --------------------------------------------- reach–resonance tradeoff */}
      {curve.length > 0 && (
        <Card className="p-4">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold">Reach vs. resonance</h3>
            <Badge variant="outline" className="text-[11px]">
              {retrieved} neighbours retrieved
            </Badge>
            <Badge variant="outline" className="text-[11px]">
              similarity floor {threshold.toFixed(2)}
            </Badge>
            <Badge className="text-[11px]">{atThreshold.length} matched</Badge>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            Drag the floor: tighter resonance, smaller audience. The shaded band is the uncertainty
            implied by the calibration priors&apos; spread.
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
              aria-label="Similarity floor"
            />
          </div>
          <p className="mt-2 text-[11px] text-muted-foreground">
            Saving at this point writes a sonic cohort with a withheld holdout slice, ready for the
            activation lane and lift measurement.
          </p>
        </Card>
      )}

      {/* ------------------------------------------------------------- results */}
      <Card className="p-4">
        <div className="flex flex-wrap items-center gap-2">
          <Users className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-semibold">
            {reweighted ? "Nearest profiles in the shared space" : "Closest records by six axes"}
          </h3>
          {reweighted && (
            <Badge variant="outline" className="text-[11px]">
              ranked by kNN, re-weighted by your sliders
            </Badge>
          )}
        </div>

        {loading ? (
          <Skeleton className="mt-3 h-40 w-full" />
        ) : reweighted ? (
          <div className="mt-3 space-y-1">
            {atThreshold.slice(0, 25).map((m, i) => (
              <div
                key={m.key}
                className="flex flex-wrap items-center gap-2 rounded-lg border border-border/50 bg-muted/10 p-2 text-xs"
              >
                <span className="w-6 text-muted-foreground">{i + 1}</span>
                <span className="min-w-0 flex-1 truncate">{m.label}</span>
                <span className="text-primary">sim {(m.knn_similarity * 100).toFixed(0)}%</span>
                <span className="text-muted-foreground">axes {(m.axis_fit * 100).toFixed(0)}%</span>
              </div>
            ))}
            {!atThreshold.length && (
              <p className="text-xs text-muted-foreground">
                Nothing clears this similarity floor — lower it to trade resonance for reach.
              </p>
            )}
          </div>
        ) : (
          <div className="mt-3 space-y-1">
            {localMatches.slice(0, 25).map((m, i) => (
              <label
                key={m.record.id}
                className="flex flex-wrap items-center gap-2 rounded-lg border border-border/50 bg-muted/10 p-2 text-xs"
              >
                <span className="w-6 text-muted-foreground">{i + 1}</span>
                <Checkbox
                  checked={seedIds.includes(m.record.id)}
                  onCheckedChange={() => toggleSeed(m.record.id)}
                  aria-label="Use as seed exemplar"
                />
                <span className="min-w-0 flex-1 truncate">
                  {m.record.external_user_id ?? m.record.source_name ?? m.record.id.slice(0, 8)}
                </span>
                <span className="text-primary">{(m.score * 100).toFixed(0)}%</span>
              </label>
            ))}
            {!localMatches.length && (
              <p className="text-xs text-muted-foreground">
                No scored records yet — upload or sync data in My data first.
              </p>
            )}
          </div>
        )}
      </Card>
    </div>
  );
};

export default PredictUsersPanel;
