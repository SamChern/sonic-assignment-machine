import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useCategoryProfiles } from "@/hooks/useCategoryProfiles";
import { CATEGORY_KEYS } from "@/lib/enterpriseSchema";
import { mapProfileInput, profileSimilarity } from "@/lib/categoryProfile";
import { toast } from "@/hooks/use-toast";
import SeedProfileCard from "./predictUsers/SeedProfileCard";
import TargetWeightsCard from "./predictUsers/TargetWeightsCard";
import ReachResonanceCard from "./predictUsers/ReachResonanceCard";
import ResultsCard from "./predictUsers/ResultsCard";
import {
  DEFAULT_WEIGHTS,
  recordScores,
  type CurvePoint,
  type DatasetOption,
  type KnnMatch,
  type RecordRow,
  type SeedTag,
  type Weights,
} from "./predictUsers/types";

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
      <SeedProfileCard
        brief={brief}
        setBrief={setBrief}
        proposeFromBrief={proposeFromBrief}
        seeding={seeding}
        seedIds={seedIds}
        seedFromRecords={seedFromRecords}
        useDatasetAverage={useDatasetAverage}
        datasetId={datasetId}
        tags={tags}
        dropTag={dropTag}
      />

      {/* ------------------------------------------------ target + re-weighting */}
      <TargetWeightsCard
        config={config}
        activeProfile={activeProfile}
        vector={vector}
        seedOrigin={seedOrigin}
        pool={pool}
        target={target}
        setTarget={setTarget}
        targetPreview={targetPreview}
        weights={weights}
        setWeights={setWeights}
        datasetId={datasetId}
        setDatasetId={setDatasetId}
        datasets={datasets}
        runMatch={runMatch}
        matching={matching}
        saveRun={saveRun}
        canWrite={canWrite}
        saving={saving}
      />

      {/* --------------------------------------------- reach–resonance tradeoff */}
      {curve.length > 0 && (
        <ReachResonanceCard
          curve={curve}
          retrieved={retrieved}
          threshold={threshold}
          setThreshold={setThreshold}
          atThresholdCount={atThreshold.length}
        />
      )}

      {/* ------------------------------------------------------------- results */}
      <ResultsCard
        loading={loading}
        reweighted={reweighted}
        atThreshold={atThreshold}
        localMatches={localMatches}
        seedIds={seedIds}
        toggleSeed={toggleSeed}
      />
    </div>
  );
};

export default PredictUsersPanel;
