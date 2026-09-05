import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  EMPTY_IDENTIFIER_FILTER,
  filterSignalPoints,
  tagOptions,
  type IdentifierFilterState,
} from "@/lib/identifierFilters";
import {
  buildSignalPoints,
  clusterSignals,
  cohortFingerprint,
  metaFingerprint,
  suggestedK,
  type IdentifierRow,
  type SourceBaseline,
} from "@/lib/identifierSignals";
import type { EntityMode } from "./types";

/**
 * Encapsulates the identifier-level (Intuizi) signal state: lazy fetch,
 * clustering into cohorts, and the derived meta/cohort fingerprints used by
 * the aggregate and compare views.
 */
export function useIdentifierSignals(entityMode: EntityMode, isAdmin: boolean) {
  const [identifierRows, setIdentifierRows] = useState<IdentifierRow[] | null>(null);
  const [sourceBaselines, setSourceBaselines] = useState<Record<string, SourceBaseline>>({});
  const [signalsLoading, setSignalsLoading] = useState(false);
  const [cohortCount, setCohortCount] = useState(4);
  const [cohortCountTouched, setCohortCountTouched] = useState(false);
  const [selectedCohortKeys, setSelectedCohortKeys] = useState<string[]>([]);
  const [identifierFilter, setIdentifierFilter] = useState<IdentifierFilterState>({
    ...EMPTY_IDENTIFIER_FILTER,
  });

  const allSignalPoints = useMemo(
    () => (identifierRows ? buildSignalPoints(identifierRows, sourceBaselines) : []),
    [identifierRows, sourceBaselines],
  );
  const signalPoints = useMemo(
    () => filterSignalPoints(allSignalPoints, identifierFilter),
    [allSignalPoints, identifierFilter],
  );
  const identifierTagOptions = useMemo(
    () => tagOptions(allSignalPoints.map(p => p.tags)),
    [allSignalPoints],
  );
  const cohorts = useMemo(() => clusterSignals(signalPoints, cohortCount), [signalPoints, cohortCount]);
  const meta = useMemo(
    () => metaFingerprint(cohorts, "All Intuizi identifiers"),
    [cohorts],
  );
  const cohortFingerprints = useMemo(() => {
    const scoped = selectedCohortKeys.length
      ? cohorts.filter(c => selectedCohortKeys.includes(c.key))
      : cohorts;
    const list = scoped.map(cohortFingerprint);
    return meta && scoped.length > 1 ? [...list, meta as any] : list;
  }, [cohorts, selectedCohortKeys, meta]);

  const toggleCohortFilter = (key: string) => {
    setSelectedCohortKeys(prev =>
      prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]
    );
  };

  const fetchSignalData = async () => {
    setSignalsLoading(true);
    try {
      const PAGE = 1000;
      const rows: IdentifierRow[] = [];
      for (let from = 0; from < 20000; from += PAGE) {
        const { data, error } = await supabase
          .from("intuizi_identifiers")
          .select(
            "id, primary_identifier, tag_codes, observation_count, last_seen_at, audio_source_id, ctv_signals, apps_signals, visitation_signals, demographics_signals, origin_signals"
          )
          .order("created_at", { ascending: false })
          .range(from, from + PAGE - 1);
        if (error) throw error;
        rows.push(...((data || []) as unknown as IdentifierRow[]));
        if (!data || data.length < PAGE) break;
      }
      setIdentifierRows(rows);

      const sourceIds = Array.from(
        new Set(rows.map(r => r.audio_source_id).filter((v): v is string => !!v))
      );
      const baselines: Record<string, SourceBaseline> = {};
      if (sourceIds.length) {
        const { data: analyses } = await supabase
          .from("source_analyses")
          .select(
            "audio_source_id, emotional_score, cognitive_score, social_score, communication_score, contextual_score, artistic_score, confidence, created_at"
          )
          .in("audio_source_id", sourceIds)
          .order("created_at", { ascending: false });
        (analyses || []).forEach(a => {
          if (!a.audio_source_id || baselines[a.audio_source_id]) return;
          baselines[a.audio_source_id] = {
            emotional: Number(a.emotional_score) || 0,
            cognitive: Number(a.cognitive_score) || 0,
            social: Number(a.social_score) || 0,
            communication: Number(a.communication_score) || 0,
            contextual: Number(a.contextual_score) || 0,
            artistic: Number(a.artistic_score) || 0,
            confidence: Number(a.confidence) || 0.5,
          };
        });
      }
      setSourceBaselines(baselines);
    } catch (err) {
      console.error("Failed to load identifier signals", err);
      toast.error("Could not load identifier-level signals");
      setIdentifierRows([]);
    } finally {
      setSignalsLoading(false);
    }
  };

  useEffect(() => {
    if (entityMode === "signal" && isAdmin && identifierRows === null && !signalsLoading) {
      fetchSignalData();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entityMode, isAdmin, identifierRows, signalsLoading]);

  // Cohort keys can disappear when the identifier filter narrows the population.
  useEffect(() => {
    setSelectedCohortKeys(prev => {
      const valid = prev.filter(k => cohorts.some(c => c.key === k));
      return valid.length === prev.length ? prev : valid;
    });
  }, [cohorts]);

  // Default cohort count follows population size until the admin overrides it.
  useEffect(() => {
    if (!cohortCountTouched && signalPoints.length) {
      setCohortCount(suggestedK(signalPoints.length));
    }
  }, [signalPoints.length, cohortCountTouched]);

  return {
    allSignalPoints,
    signalPoints,
    identifierTagOptions,
    cohorts,
    meta,
    cohortFingerprints,
    signalsLoading,
    cohortCount,
    setCohortCount,
    cohortCountTouched,
    setCohortCountTouched,
    selectedCohortKeys,
    setSelectedCohortKeys,
    toggleCohortFilter,
    identifierFilter,
    setIdentifierFilter,
  };
}
