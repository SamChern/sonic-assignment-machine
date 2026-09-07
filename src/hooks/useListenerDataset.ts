import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { CategoryKey } from "@/lib/enterpriseSchema";

export interface AxisStat {
  mean: number;
  spread: number;
  /** Ten counts, one per 0-9, 10-19 … 90-100 band. */
  histogram: number[];
}

export interface ListenerDataset {
  totals: {
    profiles: number;
    identifiers: number;
    observations: number;
    audio_grounded: number;
    avg_confidence: number;
    last_seen_at: string | null;
    updated_at: string | null;
  };
  axes: Partial<Record<CategoryKey, AxisStat>>;
  trend: { day: string; count: number; avg_confidence: number; audio_grounded: number }[];
  grounding: { level: string; count: number; avg_confidence: number; audio_grounded: number }[];
  reach: { band: string; count: number }[];
  top_tags: { code: string; count: number }[];
  window_days: number;
  tag_sample: number;
  computed_at: string;
}

/**
 * Reads the admin-only aggregate view of the listener population. The table
 * itself is service-role only, so everything comes back pre-aggregated from one
 * SECURITY DEFINER call that re-checks the admin role server-side.
 */
export const useListenerDataset = (days = 30) => {
  const [data, setData] = useState<ListenerDataset | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data: raw, error: rpcError } = await supabase.rpc(
      "admin_listener_population_stats" as never,
      { p_days: days } as never,
    );
    if (rpcError) {
      setError(
        /timeout|canceling statement/i.test(rpcError.message)
          ? "The population summary took too long to build. Try again in a moment."
          : rpcError.message,
      );
      setData(null);
    } else {
      setData(raw as unknown as ListenerDataset);
    }
    setLoading(false);
  }, [days]);

  useEffect(() => {
    void load();
  }, [load]);

  return { data, loading, error, reload: load };
};

/** Median interpolated from a 10-band histogram (the server skips the sort). */
export const histogramMedian = (histogram: number[]) => {
  const total = histogram.reduce((s, n) => s + n, 0);
  if (!total) return 0;
  let seen = 0;
  for (let i = 0; i < histogram.length; i += 1) {
    const next = seen + histogram[i];
    if (next >= total / 2) {
      const within = histogram[i] ? (total / 2 - seen) / histogram[i] : 0;
      return Math.round((i + within) * 10);
    }
    seen = next;
  }
  return 100;
};
