import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "./useAuth";
import { useCallback } from "react";

export interface UserFingerprint {
  id: string;
  user_id: string;
  emotional_avg: number;
  cognitive_avg: number;
  social_avg: number;
  communication_avg: number;
  contextual_avg: number;
  artistic_avg: number;
  // Recent (last 30 days)
  emotional_avg_recent: number;
  cognitive_avg_recent: number;
  social_avg_recent: number;
  communication_avg_recent: number;
  contextual_avg_recent: number;
  artistic_avg_recent: number;
  recent_sources_analyzed: number;
  // Confidence
  fingerprint_confidence: number;
  total_sources_analyzed: number;
  created_at: string;
  updated_at: string;
  // Joined profile data
  username?: string | null;
  avatar_url?: string | null;
}

export interface SourceAnalysis {
  id: string;
  user_id: string;
  audio_source_id: string | null;
  source_name: string;
  emotional_score: number;
  cognitive_score: number;
  social_score: number;
  communication_score: number;
  contextual_score: number;
  artistic_score: number;
  emotional_desc: string | null;
  cognitive_desc: string | null;
  social_desc: string | null;
  communication_desc: string | null;
  contextual_desc: string | null;
  artistic_desc: string | null;
  confidence: number;
  created_at: string;
}

// Fetch functions extracted for React Query
async function fetchMyFingerprintData(userId: string): Promise<UserFingerprint | null> {
  const { data, error } = await supabase
    .from('user_fingerprints')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle();

  if (error) {
    console.error('Error fetching fingerprint:', error);
    throw error;
  }

  return data as UserFingerprint | null;
}

async function fetchMyAnalysesData(userId: string): Promise<SourceAnalysis[]> {
  const { data, error } = await supabase
    .from('source_analyses')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Error fetching analyses:', error);
    throw error;
  }

  return (data || []) as SourceAnalysis[];
}

async function fetchAllFingerprintsData(): Promise<UserFingerprint[]> {
  const { data: fingerprints, error: fpError } = await supabase
    .from('user_fingerprints')
    .select('*')
    .gt('total_sources_analyzed', 0)
    .order('total_sources_analyzed', { ascending: false });

  if (fpError) {
    console.error('Error fetching all fingerprints:', fpError);
    throw fpError;
  }

  const userIds = (fingerprints || []).map(fp => fp.user_id);
  if (userIds.length === 0) {
    return [];
  }

  const { data: profiles } = await supabase
    .from('profiles')
    .select('user_id, username, avatar_url')
    .in('user_id', userIds);

  const merged = (fingerprints || []).map(fp => {
    const profile = (profiles || []).find(p => p.user_id === fp.user_id);
    return {
      ...fp,
      username: profile?.username || null,
      avatar_url: profile?.avatar_url || null,
    };
  });

  return merged as UserFingerprint[];
}

export function useFingerprints() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const {
    data: myFingerprint = null,
    isLoading: isLoadingMyFingerprint,
  } = useQuery({
    queryKey: ['fingerprint', user?.id],
    queryFn: () => fetchMyFingerprintData(user!.id),
    enabled: !!user,
    staleTime: 2 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
  });

  const {
    data: myAnalyses = [],
    isLoading: isLoadingMyAnalyses,
  } = useQuery({
    queryKey: ['analyses', user?.id],
    queryFn: () => fetchMyAnalysesData(user!.id),
    enabled: !!user,
    staleTime: 2 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
  });

  const {
    data: allFingerprints = [],
    isLoading: isLoadingAllFingerprints,
  } = useQuery({
    queryKey: ['fingerprints', 'all'],
    queryFn: fetchAllFingerprintsData,
    staleTime: 5 * 60 * 1000,
    gcTime: 15 * 60 * 1000,
  });

  const loading = isLoadingMyFingerprint || isLoadingMyAnalyses || isLoadingAllFingerprints;

  const refresh = useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['fingerprint', user?.id] }),
      queryClient.invalidateQueries({ queryKey: ['analyses', user?.id] }),
      queryClient.invalidateQueries({ queryKey: ['fingerprints', 'all'] }),
    ]);
  }, [queryClient, user?.id]);

  return {
    myFingerprint,
    allFingerprints,
    myAnalyses,
    loading,
    refresh,
  };
}
