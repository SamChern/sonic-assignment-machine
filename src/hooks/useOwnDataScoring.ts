import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export interface OwnDataTotals {
  rows_total: number;
  rows_scored: number;
  rows_pending: number;
  rows_unresolved: number;
  avg_confidence: number | null;
  avg_scores: Record<string, number | null>;
}

export interface OwnDataDataset {
  dataset_id: string;
  name: string | null;
  rows_total: number;
  rows_scored: number;
  rows_pending: number;
  rows_unresolved: number;
  avg_confidence: number | null;
}

export interface OwnDataRun {
  id: string;
  dataset_id: string | null;
  trigger_source: string;
  status: string;
  processed: number;
  scored: number;
  unresolved: number;
  datasets_touched: number;
  avg_confidence: number | null;
  error: string | null;
  started_at: string;
  finished_at: string | null;
}

export interface OwnDataSummary {
  totals: OwnDataTotals;
  datasets: OwnDataDataset[];
  last_run: OwnDataRun | null;
  computed_at: string;
}

/**
 * Confidence numbers that come from the account's own rows, plus the control to
 * run the scoring worker over whatever is still waiting.
 */
export function useOwnDataScoring(organizationId: string) {
  const [summary, setSummary] = useState<OwnDataSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [runNote, setRunNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!organizationId) return;
    setLoading(true);
    setError(null);
    const { data, error: err } = await supabase.rpc("org_own_data_confidence", {
      _organization_id: organizationId,
    });
    setLoading(false);
    if (err) {
      setError(err.message);
      setSummary(null);
      return;
    }
    setSummary(data as unknown as OwnDataSummary);
  }, [organizationId]);

  useEffect(() => {
    void load();
  }, [load]);

  const runScoring = useCallback(async () => {
    if (!organizationId) return;
    setRunning(true);
    setRunNote(null);
    setError(null);
    const { data, error: err } = await supabase.functions.invoke("enterprise-score-worker", {
      body: { action: "run", organization_id: organizationId },
    });
    setRunning(false);
    const payload = data as
      | { success?: boolean; scored?: number; unresolved?: number; processed?: number; error?: string }
      | null;
    if (err || payload?.success === false) {
      setError(payload?.error ?? err?.message ?? "Scoring run failed");
    } else if ((payload?.processed ?? 0) === 0) {
      setRunNote("Nothing was waiting — every row already has scores.");
    } else {
      setRunNote(
        `Scored ${(payload?.scored ?? 0).toLocaleString()} rows` +
          (payload?.unresolved
            ? `, ${payload.unresolved.toLocaleString()} still need audio evidence.`
            : "."),
      );
    }
    await load();
  }, [organizationId, load]);

  return { summary, loading, running, error, runNote, load, runScoring };
}

export default useOwnDataScoring;
