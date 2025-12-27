import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "./useAuth";

export interface UserFingerprint {
  id: string;
  user_id: string;
  emotional_avg: number;
  cognitive_avg: number;
  social_avg: number;
  communication_avg: number;
  contextual_avg: number;
  artistic_avg: number;
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
  created_at: string;
}

export function useFingerprints() {
  const { user, isAdmin } = useAuth();
  const [myFingerprint, setMyFingerprint] = useState<UserFingerprint | null>(null);
  const [allFingerprints, setAllFingerprints] = useState<UserFingerprint[]>([]);
  const [myAnalyses, setMyAnalyses] = useState<SourceAnalysis[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchMyFingerprint = useCallback(async () => {
    if (!user) {
      setMyFingerprint(null);
      return;
    }

    const { data, error } = await supabase
      .from('user_fingerprints')
      .select('*')
      .eq('user_id', user.id)
      .maybeSingle();

    if (error) {
      console.error('Error fetching fingerprint:', error);
      return;
    }

    setMyFingerprint(data);
  }, [user]);

  const fetchMyAnalyses = useCallback(async () => {
    if (!user) {
      setMyAnalyses([]);
      return;
    }

    const { data, error } = await supabase
      .from('source_analyses')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Error fetching analyses:', error);
      return;
    }

    setMyAnalyses(data || []);
  }, [user]);

  const fetchAllFingerprints = useCallback(async () => {
    // Fetch all fingerprints (public via RLS)
    const { data: fingerprints, error: fpError } = await supabase
      .from('user_fingerprints')
      .select('*')
      .gt('total_sources_analyzed', 0)
      .order('total_sources_analyzed', { ascending: false });

    if (fpError) {
      console.error('Error fetching all fingerprints:', fpError);
      return;
    }

    // Fetch profiles to get usernames
    const userIds = (fingerprints || []).map(fp => fp.user_id);
    if (userIds.length === 0) {
      setAllFingerprints([]);
      return;
    }

    const { data: profiles } = await supabase
      .from('profiles')
      .select('user_id, username, avatar_url')
      .in('user_id', userIds);

    // Merge fingerprints with profile data
    const merged = (fingerprints || []).map(fp => {
      const profile = (profiles || []).find(p => p.user_id === fp.user_id);
      return {
        ...fp,
        username: profile?.username || null,
        avatar_url: profile?.avatar_url || null,
      };
    });

    setAllFingerprints(merged);
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    await Promise.all([
      fetchMyFingerprint(),
      fetchMyAnalyses(),
      fetchAllFingerprints(),
    ]);
    setLoading(false);
  }, [fetchMyFingerprint, fetchMyAnalyses, fetchAllFingerprints]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return {
    myFingerprint,
    allFingerprints,
    myAnalyses,
    loading,
    refresh,
  };
}
