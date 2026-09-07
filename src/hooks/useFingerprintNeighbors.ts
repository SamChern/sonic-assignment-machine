import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * Taste neighbours come from a server-side lookup: other people's category
 * averages are private, so the database compares them for us and returns only
 * a display name, picture, source count and a match percentage.
 */
export interface FingerprintNeighbor {
  user_id: string;
  username: string | null;
  avatar_url: string | null;
  total_sources_analyzed: number;
  similarity: number;
  top_shared_category: string | null;
}

export interface NeighborScores {
  emotional: number;
  cognitive: number;
  social: number;
  communication: number;
  contextual: number;
  artistic: number;
}

export async function fetchFingerprintNeighbors(
  scores: NeighborScores,
  limit = 5,
): Promise<FingerprintNeighbor[]> {
  const { data, error } = await supabase.rpc("fingerprint_neighbors", {
    _emotional: scores.emotional,
    _cognitive: scores.cognitive,
    _social: scores.social,
    _communication: scores.communication,
    _contextual: scores.contextual,
    _artistic: scores.artistic,
    _limit: limit,
  });

  if (error) {
    console.error("Error fetching taste neighbors:", error);
    throw error;
  }

  return ((data || []) as FingerprintNeighbor[]).map((row) => ({
    ...row,
    similarity: Number(row.similarity) || 0,
    total_sources_analyzed: Number(row.total_sources_analyzed) || 0,
  }));
}

export function useFingerprintNeighbors(scores: NeighborScores | null, limit = 5) {
  return useQuery({
    queryKey: ["fingerprint-neighbors", scores, limit],
    queryFn: () => fetchFingerprintNeighbors(scores!, limit),
    enabled: !!scores,
    staleTime: 5 * 60 * 1000,
    gcTime: 15 * 60 * 1000,
  });
}
