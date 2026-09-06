import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

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
 * Feeds the home page waveform from the signed-in person's own most recent
 * analysis, so the shape on screen is a real result of theirs rather than an
 * invented pattern. Signed-out visitors (and people with no analyses yet) get a
 * clearly labelled illustrative sample instead.
 */
export function useScopeShowcase() {
  const { user } = useAuth();
  const { data } = useQuery({
    queryKey: ["scope-showcase", user?.id ?? "anon"],
    enabled: !!user,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data: row, error } = await supabase
        .from("source_analyses")
        .select(
          "source_name,emotional_score,cognitive_score,social_score,communication_score,contextual_score,artistic_score",
        )
        .eq("user_id", user!.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error || !row) return null;

      const scores: ScopeScores = {
        emotional: Math.round(Number(row.emotional_score) || 0),
        cognitive: Math.round(Number(row.cognitive_score) || 0),
        social: Math.round(Number(row.social_score) || 0),
        communication: Math.round(Number(row.communication_score) || 0),
        contextual: Math.round(Number(row.contextual_score) || 0),
        artistic: Math.round(Number(row.artistic_score) || 0),
      };
      return { scores, name: row.source_name as string | null };
    },
  });

  if (!data) {
    return { scores: SAMPLE, isLive: false, sublabel: "Illustrative sample pattern" };
  }
  return {
    scores: data.scores,
    isLive: true,
    sublabel: data.name ? `Your latest analysis · ${data.name}` : "Your latest analysis",
  };
}
