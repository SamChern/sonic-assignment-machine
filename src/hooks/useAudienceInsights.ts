import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { CategoryKey } from "@/lib/enterpriseSchema";

export interface InsightTag {
  code: string;
  count: number;
  /** Percentage of sampled profiles carrying this tag. */
  share: number;
  scores: Record<CategoryKey, number>;
  confidence: number;
}

export interface InsightFamily {
  family: string;
  distinct_tags: number;
  total_mentions: number;
  tags: InsightTag[];
}

export interface AudienceInsights {
  sampled_profiles: number;
  families: InsightFamily[];
  sample_size: number;
  computed_at: string;
}

/**
 * Admin-only view of what the real listener population is made of: which tags,
 * demographics and category scores show up most. The profile table is
 * service-role only, so the grouping happens inside one SECURITY DEFINER call
 * that re-checks the admin role server-side.
 */
export const useAudienceInsights = (sample = 40000, perFamily = 12) => {
  const [data, setData] = useState<AudienceInsights | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data: raw, error: rpcError } = await supabase.rpc(
      "admin_listener_audience_insights" as never,
      { p_sample: sample, p_per_family: perFamily } as never,
    );
    if (rpcError) {
      setError(
        /timeout|canceling statement/i.test(rpcError.message)
          ? "That summary took too long to build. Try a smaller sample."
          : rpcError.message,
      );
      setData(null);
    } else {
      setData(raw as unknown as AudienceInsights);
    }
    setLoading(false);
  }, [sample, perFamily]);

  useEffect(() => {
    void load();
  }, [load]);

  return { data, loading, error, reload: load };
};

/** "demo.age.50-54" reads badly in a report; show the human part. */
export const prettyTag = (code: string) =>
  code
    .replace(/^demo\.age\./, "")
    .replace(/^demo\./, "")
    .replace(/^ctv\.(genre|channel)\./, "")
    .replace(/^iab\./, "IAB ")
    .replace(/[-_]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
