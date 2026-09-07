import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { CategoryKey } from "@/lib/enterpriseSchema";

export interface CategoryTrendPoint {
  bucket: string;
  count: number;
  confidence: number | null;
  /** Null when nothing was analysed in this period — the chart shows a gap. */
  scores: Partial<Record<CategoryKey, number>> | null;
}

export interface CategoryScoreTrend {
  points: CategoryTrendPoint[];
  bucket: "day" | "week" | "month";
  window_days: number;
  first_analysis_at: string | null;
  last_analysis_at: string | null;
  computed_at: string;
}


/**
 * Admin-only per-category score history. The aggregation happens server-side in
 * one SECURITY DEFINER call that re-checks the admin role, so the client never
 * scans the analysis table itself.
 */
export const useCategoryScoreTrend = (days = 60) => {
  const [data, setData] = useState<CategoryScoreTrend | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data: raw, error: rpcError } = await supabase.rpc(
      "admin_category_score_trend" as never,
      { p_days: days } as never,
    );
    if (rpcError) {
      setError(
        /timeout|canceling statement/i.test(rpcError.message)
          ? "The score history took too long to build. Try a shorter window."
          : rpcError.message,
      );
      setData(null);
    } else {
      setData(raw as unknown as CategoryScoreTrend);
    }
    setLoading(false);
  }, [days]);

  useEffect(() => {
    void load();
  }, [load]);

  return { data, loading, error, reload: load };
};
