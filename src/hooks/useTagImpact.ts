import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export interface TagStat {
  kpi_metric: string;
  events: number;
  devices: number;
  avg_value: number;
}

export interface TagImpactRow {
  analysis_id: string;
  source_name: string;
  created_at: string;
  confidence: number | null;
  predicted: number;
  delta: number;
  delta_pct: number | null;
  lead_category: string | null;
}

export interface TagImpactDriver {
  category: string;
  per_10_points: number;
  per_10_ci: [number, number];
  inconclusive: boolean;
  /** True when this score never varied across the matched devices. */
  no_variation?: boolean;
}

export interface TagImpact {
  success: boolean;
  fitted: boolean;
  reason?: "no_tags" | "not_enough_matches" | "not_fittable";
  tags: TagStat[];
  kpi_metric?: string;
  matched_rows?: number;
  min_rows?: number;
  audio_rows: number;
  audio_source?: "account_analyses" | "account_data_rows";
  fitted_axes?: string[];
  baseline?: number;
  r2?: number;
  engine?: "ec2" | "edge";
  drivers?: TagImpactDriver[];
  conclusive_axes?: number;
  rows?: TagImpactRow[];
  computed_at: string;
}

/**
 * Predicted impact of the account's own audio rows on one of its measured site
 * tags. Everything comes from the account's own events and scored device rows;
 * when there isn't enough measured data the response says so rather than
 * inventing a number.
 */
export function useTagImpact(organizationId: string) {
  const [metric, setMetric] = useState<string | null>(null);
  const [data, setData] = useState<TagImpact | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (kpiMetric?: string | null) => {
      setLoading(true);
      setError(null);
      const { data: res, error: err } = await supabase.functions.invoke(
        "enrichment-tag-impact",
        {
          body: {
            organization_id: organizationId,
            kpi_metric: kpiMetric ?? null,
            limit: 20,
          },
        },
      );
      setLoading(false);
      if (err) {
        setError(err.message);
        return;
      }
      const payload = res as TagImpact;
      if (!payload?.success) {
        setError((res as { error?: string })?.error ?? "Could not work out tag impact.");
        return;
      }
      setData(payload);
      if (payload.kpi_metric) setMetric(payload.kpi_metric);
    },
    [organizationId],
  );

  useEffect(() => {
    void load(null);
  }, [load]);

  const selectMetric = useCallback(
    (next: string) => {
      setMetric(next);
      void load(next);
    },
    [load],
  );

  return { data, loading, error, metric, selectMetric, reload: () => void load(metric) };
}
