import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type ScopeScores = {
  emotional: number;
  cognitive: number;
  social: number;
  communication: number;
  contextual: number;
  artistic: number;
};

/** Shown only when there is nothing real to show yet — labelled as such in the UI. */
const SAMPLE: ScopeScores = {
  emotional: 72,
  cognitive: 58,
  social: 46,
  communication: 64,
  contextual: 55,
  artistic: 68,
};

/**
 * Averages the most recent real analyses so the home page waveform reflects
 * actual results instead of invented numbers. Falls back to a clearly labelled
 * sample when the platform has no analyses yet.
 */
export function useScopeShowcase() {
  const { data } = useQuery({
    queryKey: ["scope-showcase"],
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data: rows, error } = await supabase
        .from("source_analyses")
        .select(
          "emotional_score,cognitive_score,social_score,communication_score,contextual_score,artistic_score",
        )
        .order("created_at", { ascending: false })
        .limit(50);
      if (error || !rows?.length) return null;

      const sum: ScopeScores = {
        emotional: 0,
        cognitive: 0,
        social: 0,
        communication: 0,
        contextual: 0,
        artistic: 0,
      };
      for (const r of rows) {
        sum.emotional += Number(r.emotional_score) || 0;
        sum.cognitive += Number(r.cognitive_score) || 0;
        sum.social += Number(r.social_score) || 0;
        sum.communication += Number(r.communication_score) || 0;
        sum.contextual += Number(r.contextual_score) || 0;
        sum.artistic += Number(r.artistic_score) || 0;
      }
      const n = rows.length;
      const scores = Object.fromEntries(
        Object.entries(sum).map(([k, v]) => [k, Math.round(v / n)]),
      ) as ScopeScores;
      return { scores, count: n };
    },
  });

  if (!data) {
    return { scores: SAMPLE, isLive: false, sublabel: "Illustrative sample pattern" };
  }
  return {
    scores: data.scores,
    isLive: true,
    sublabel: `Average of the ${data.count} most recent analyses`,
  };
}
