import { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { AudioSourceWithProfile, UserProfile } from "@/components/admin/workbench/types";

/**
 * Fetches and derives the raw admin-workbench dataset: profiles, audio
 * sources (joined to their owning profile) and per-source Intuizi signal
 * counts, plus a few cheap derived lookups shared across tabs.
 */
export function useWorkbenchData() {
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [allSources, setAllSources] = useState<AudioSourceWithProfile[]>([]);
  const [signalCounts, setSignalCounts] = useState<Record<string, number>>({});
  const [dataLoading, setDataLoading] = useState(true);

  const fetchAllData = async () => {
    setDataLoading(true);

    // Fetch all profiles
    const { data: profilesData } = await supabase
      .from('profiles')
      .select('*')
      .order('created_at', { ascending: false });

    setUsers(profilesData || []);

    // Fetch all audio sources
    const { data: sourcesData } = await supabase
      .from('audio_sources')
      .select('*')
      .order('created_at', { ascending: false });

    // Map profiles to sources
    const sourcesWithProfiles = (sourcesData || []).map(source => ({
      ...source,
      profile: (profilesData || []).find(p => p.user_id === source.user_id) || null,
    }));

    setAllSources(sourcesWithProfiles);

    // Intuizi signal volume per audio source (linked identifiers)
    const { data: identifierRows } = await supabase
      .from('intuizi_identifiers')
      .select('audio_source_id, observation_count');

    const counts: Record<string, number> = {};
    (identifierRows || []).forEach(row => {
      if (!row.audio_source_id) return;
      counts[row.audio_source_id] = (counts[row.audio_source_id] || 0) + 1;
    });
    setSignalCounts(counts);

    setDataLoading(false);
  };

  const sourceCountByUser = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const s of allSources) counts[s.user_id] = (counts[s.user_id] || 0) + 1;
    return counts;
  }, [allSources]);

  const providerKeys = useMemo(
    () => Array.from(new Set(allSources.map(s => s.source_type))).sort(),
    [allSources],
  );

  return {
    users,
    allSources,
    signalCounts,
    dataLoading,
    fetchAllData,
    sourceCountByUser,
    providerKeys,
  };
}
