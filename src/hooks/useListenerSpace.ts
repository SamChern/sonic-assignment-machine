import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "./useAuth";
import { CATEGORY_META } from "@/lib/mcpResultInsights";

export interface ListenerAnalysisRow {
  id: string;
  source_name: string | null;
  audio_source_id: string | null;
  created_at: string;
  confidence: number | null;
  grounding_level: string | null;
  emotional_score: number | null;
  cognitive_score: number | null;
  social_score: number | null;
  communication_score: number | null;
  contextual_score: number | null;
  artistic_score: number | null;
}

const COLUMNS =
  "id,source_name,audio_source_id,created_at,confidence,grounding_level,emotional_score,cognitive_score,social_score,communication_score,contextual_score,artistic_score";

/**
 * Everything a Listener's own dashboard needs: the sounds they have had read,
 * the six scores each one came back with, and the shape those add up to.
 * Scoped to the signed-in account only.
 */
export function useListenerSpace() {
  const { user } = useAuth();

  const query = useQuery({
    queryKey: ["listener-space", "analyses", user?.id],
    enabled: !!user,
    staleTime: 60 * 1000,
    queryFn: async (): Promise<ListenerAnalysisRow[]> => {
      const { data, error } = await supabase
        .from("source_analyses")
        .select(COLUMNS)
        .eq("user_id", user!.id)
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return (data ?? []) as unknown as ListenerAnalysisRow[];
    },
  });

  const analyses = query.data ?? [];

  const latest = analyses[0] ?? null;

  const scoresOf = (row: ListenerAnalysisRow | null) =>
    CATEGORY_META.map((c) => ({
      ...c,
      value: Math.round(
        Number((row as unknown as Record<string, unknown>)?.[`${c.key}_score`] ?? 0),
      ),
    }));

  const averages = useMemo(() => {
    const keys = CATEGORY_META.map((c) => c.key);
    const sums: Record<string, number> = {};
    keys.forEach((k) => (sums[k] = 0));
    let counted = 0;
    for (const row of analyses) {
      const vals = keys.map((k) => Number((row as unknown as Record<string, unknown>)[`${k}_score`]));
      if (vals.some((v) => !Number.isFinite(v))) continue;
      keys.forEach((k, i) => (sums[k] += vals[i]));
      counted += 1;
    }
    return CATEGORY_META.map((c) => ({
      ...c,
      value: counted ? Math.round(sums[c.key] / counted) : 0,
    }));
  }, [analyses]);

  const strongest = useMemo(
    () => [...averages].sort((a, b) => b.value - a.value)[0] ?? null,
    [averages],
  );
  const quietest = useMemo(
    () => [...averages].sort((a, b) => a.value - b.value)[0] ?? null,
    [averages],
  );

  return {
    loading: query.isLoading,
    error: query.error as Error | null,
    analyses,
    latest,
    latestScores: scoresOf(latest),
    scoresOf,
    averages,
    analysedCount: analyses.length,
    strongest,
    quietest,
    refresh: async () => {
      await query.refetch();
    },
  };
}
