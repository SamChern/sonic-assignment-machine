/**
 * Per-dataset scoring progress for one enterprise account: how many rows are
 * scored, how many carry audio-grounded evidence, and how confident the
 * scores are.
 */
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export interface DatasetRun {
  status: string | null;
  processed: number | null;
  scored: number | null;
  unresolved: number | null;
  avg_confidence: number | null;
  trigger_source: string | null;
  error: string | null;
  started_at: string | null;
  finished_at: string | null;
}

export interface DatasetProgress {
  dataset_id: string;
  name: string;
  source_kind: string | null;
  status: string | null;
  shared: boolean | null;
  row_count: number | null;
  rows: number;
  scored: number;
  unresolved: number;
  pending: number;
  avg_confidence: number | null;
  sampled: number;
  matched: number;
  grounded: number;
  bridged: number;
  audio_evidence: number;
  grounded_pct: number;
  audio_pct: number;
  grounded_est: number;
  audio_evidence_est: number;
  averages: Record<string, number | null>;
  last_run: DatasetRun | null;
}

export interface ScoringProgressReport {
  organization_id: string;
  sample_size: number;
  computed_at: string;
  datasets: DatasetProgress[];
}

export const useScoringProgress = (organizationId: string | null) => {
  const [report, setReport] = useState<ScoringProgressReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!organizationId) {
      setReport(null);
      return;
    }
    setLoading(true);
    const { data, error: rpcError } = await supabase.rpc("admin_enterprise_scoring_progress", {
      _organization_id: organizationId,
      _sample: 600,
    });
    if (rpcError) {
      setError(rpcError.message);
      setReport(null);
    } else {
      setError(null);
      setReport(data as unknown as ScoringProgressReport);
    }
    setLoading(false);
  }, [organizationId]);

  useEffect(() => {
    void load();
  }, [load]);

  return { report, loading, error, reload: load };
};

export default useScoringProgress;
