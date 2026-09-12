/**
 * Admin drill-down over one predicted segment (sonic cohort).
 *
 * Segment membership keys never leave the server for non-admins: both RPCs
 * refuse unless the caller holds the admin role. Devices come from a bounded
 * sample of the segment ordered by match strength, and the tag figures are the
 * measured events for those devices compared with everyone else.
 */
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export interface CohortSummary {
  id: string;
  name: string | null;
  slug: string | null;
  organization_id: string | null;
  description: string | null;
  export_eligible: boolean | null;
  created_at: string;
  members: number;
  holdout: number;
  avg_similarity: number | null;
}

export interface CohortDevice {
  subject_key: string;
  similarity: number | null;
  holdout: boolean | null;
  added_at: string | null;
  report_type: string | null;
  status: string | null;
  activation_id: string | null;
  confidence: number | null;
  grounding_level: string;
  scores: Record<string, number | null> | null;
}

export interface CohortTagImpact {
  kpi_metric: string;
  segment_events: number;
  segment_devices: number;
  segment_avg: number | null;
  other_events: number;
  other_devices: number;
  other_avg: number | null;
  lift_pct: number | null;
}

export interface CohortExplorerData {
  cohort: {
    id: string;
    name: string | null;
    slug: string | null;
    narrative: string | null;
    description: string | null;
    export_eligible: boolean | null;
    member_count: number | null;
    created_at: string;
  };
  members: number;
  holdout: number;
  avg_similarity: number | null;
  sampled: number;
  scored: number;
  audio_grounded: number;
  avg_scores: Record<string, number>;
  devices: CohortDevice[];
  tag_impact: CohortTagImpact[];
  tag_devices: number;
  window_days: number;
  computed_at: string;
}

export const COHORT_PAGE_SIZE = 20;

export const useCohortExplorer = () => {
  const [cohorts, setCohorts] = useState<CohortSummary[]>([]);
  const [cohortId, setCohortId] = useState<string>("");
  const [data, setData] = useState<CohortExplorerData | null>(null);
  const [page, setPage] = useState(0);
  const [listLoading, setListLoading] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadList = useCallback(async () => {
    setListLoading(true);
    setError(null);
    const { data: res, error: err } = await supabase.rpc("admin_cohort_list", {
      _limit: 100,
    });
    if (err) {
      setError(err.message);
      setCohorts([]);
    } else {
      const rows = ((res as { cohorts?: CohortSummary[] })?.cohorts ?? []) as CohortSummary[];
      setCohorts(rows);
      setCohortId((prev) => prev || rows[0]?.id || "");
    }
    setListLoading(false);
  }, []);

  useEffect(() => {
    void loadList();
  }, [loadList]);

  const load = useCallback(async () => {
    if (!cohortId) return;
    setLoading(true);
    setError(null);
    const { data: res, error: err } = await supabase.rpc("admin_cohort_explorer", {
      _cohort_id: cohortId,
      _limit: COHORT_PAGE_SIZE,
      _offset: page * COHORT_PAGE_SIZE,
    });
    if (err) {
      setError(err.message);
      setData(null);
    } else {
      setData(res as unknown as CohortExplorerData);
    }
    setLoading(false);
  }, [cohortId, page]);

  useEffect(() => {
    void load();
  }, [load]);

  const select = useCallback((id: string) => {
    setCohortId(id);
    setPage(0);
  }, []);

  return {
    cohorts,
    cohortId,
    select,
    data,
    page,
    setPage,
    listLoading,
    loading,
    error,
    refresh: load,
    refreshList: loadList,
  };
};

export default useCohortExplorer;
