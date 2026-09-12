/**
 * Stage-by-stage device counts for the data feeds shared with one account.
 * Landed and scored totals are exact; the audio-linked and labelled figures
 * come from a bounded sample, so they are reported as estimates.
 */
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export interface FeedStages {
  activation_id: string;
  label: string | null;
  is_active: boolean;
  raw: number;
  scored: number;
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
  feeds: FeedStages[];
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
      _feeds: 6,
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
