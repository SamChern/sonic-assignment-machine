import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "./useAuth";
import { CATEGORY_META } from "@/lib/mcpResultInsights";

export interface CreatorAnalysisRow {
  id: string;
  source_name: string | null;
  audio_source_id: string | null;
  created_at: string;
  grounding_level: string | null;
  emotional_score: number | null;
  cognitive_score: number | null;
  social_score: number | null;
  communication_score: number | null;
  contextual_score: number | null;
  artistic_score: number | null;
}

export interface CreatorWorkRow {
  id: string;
  title: string;
  machine_use_terms: string;
  corpus_opt_in: boolean;
  registered_at: string | null;
  withdrawn_at: string | null;
  divergence: number | null;
  resonance: number | null;
}

const ANALYSIS_COLUMNS =
  "id,source_name,audio_source_id,created_at,grounding_level,emotional_score,cognitive_score,social_score,communication_score,contextual_score,artistic_score";

/**
 * Everything one creator's own space needs: their analysed sounds, the works
 * they registered, and the averages those analyses add up to. Scoped to the
 * signed-in account only — no cross-account reads.
 */
export function useCreatorSpace() {
  const { user } = useAuth();

  const analysesQuery = useQuery({
    queryKey: ["creator-space", "analyses", user?.id],
    enabled: !!user,
    staleTime: 2 * 60 * 1000,
    queryFn: async (): Promise<CreatorAnalysisRow[]> => {
      const { data, error } = await supabase
        .from("source_analyses")
        .select(ANALYSIS_COLUMNS)
        .eq("user_id", user!.id)
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return (data ?? []) as unknown as CreatorAnalysisRow[];
    },
  });

  const worksQuery = useQuery({
    queryKey: ["creator-space", "works", user?.id],
    enabled: !!user,
    staleTime: 2 * 60 * 1000,
    queryFn: async (): Promise<CreatorWorkRow[]> => {
      const { data, error } = await supabase
        .from("creator_works")
        .select(
          "id,title,machine_use_terms,corpus_opt_in,registered_at,withdrawn_at,divergence,resonance",
        )
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return (data ?? []) as unknown as CreatorWorkRow[];
    },
  });

  const analyses = analysesQuery.data ?? [];
  const works = worksQuery.data ?? [];

  const averages = useMemo(() => {
    const keys = CATEGORY_META.map((c) => c.key);
    const sums: Record<string, number> = {};
    keys.forEach((k) => (sums[k] = 0));
    let counted = 0;
    for (const row of analyses) {
      const vals = keys.map((k) => Number((row as never as Record<string, unknown>)[`${k}_score`]));
      if (vals.some((v) => !Number.isFinite(v))) continue;
      keys.forEach((k, i) => (sums[k] += vals[i]));
      counted += 1;
    }
    return CATEGORY_META.map((c) => ({
      ...c,
      value: counted ? Math.round(sums[c.key] / counted) : 0,
    }));
  }, [analyses]);

  const analysedCount = analyses.length;
  const strongest = useMemo(
    () => [...averages].sort((a, b) => b.value - a.value)[0] ?? null,
    [averages],
  );
  const quietest = useMemo(
    () => [...averages].sort((a, b) => a.value - b.value)[0] ?? null,
    [averages],
  );

  const registeredCount = works.filter((w) => w.registered_at && !w.withdrawn_at).length;
  const sharedCount = works.filter((w) => w.corpus_opt_in && !w.withdrawn_at).length;

  return {
    loading: analysesQuery.isLoading || worksQuery.isLoading,
    error: (analysesQuery.error ?? worksQuery.error) as Error | null,
    analyses,
    works,
    averages,
    analysedCount,
    registeredCount,
    sharedCount,
    strongest,
    quietest,
    refresh: async () => {
      await Promise.all([analysesQuery.refetch(), worksQuery.refetch()]);
    },
  };
}
