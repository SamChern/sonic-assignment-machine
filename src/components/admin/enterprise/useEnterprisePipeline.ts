/**
 * Stage-by-stage row counts for each dataset in one account.
 * Landed, scored, waiting and failed totals are exact; the audio-linked and
 * labelled figures come from a bounded sample, so they are reported as estimates.
 */
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export interface DatasetStages {
  dataset_id: string;
  name: string;
  source_kind: string | null;
  status: string | null;
  shared: boolean;
  raw: number;
  scored: number;
  pending: number;
  failed: number;
  oldest_pending_at: string | null;
  last_scored_at: string | null;
  pending_age_hours: number | null;
  sampled: number;
  enriched_sampled: number;
  tagged_sampled: number;
  enriched_pct: number;
  tagged_pct: number;
  enriched_est: number;
  tagged_est: number;
}

export interface PipelineReport {
  organization_id: string;
  sample_size: number;
  datasets: DatasetStages[];
  computed_at: string;
}

export const useEnterprisePipeline = (organizationId: string | null) => {
  const [report, setReport] = useState<PipelineReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!organizationId) {
      setReport(null);
      return;
    }
    setLoading(true);
    const { data, error: rpcError } = await supabase.rpc("admin_enterprise_pipeline", {
      _organization_id: organizationId,
      _sample: 1000,
      _feeds: 12,
    });
    if (rpcError) {
      setError(rpcError.message);
      setReport(null);
    } else {
      setError(null);
      setReport(data as unknown as PipelineReport);
    }
    setLoading(false);
  }, [organizationId]);

  useEffect(() => {
    void load();
  }, [load]);

  return { report, loading, error, reload: load };
};

export default useEnterprisePipeline;
