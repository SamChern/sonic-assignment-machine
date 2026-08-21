import { useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from './useAuth';
import { toast } from 'sonner';

export interface AudioSource {
  id: string;
  user_id: string;
  source_type: string;
  name: string;
  spotify_id: string | null;
  spotify_url: string | null;
  album_name: string | null;
  album_image: string | null;
  artists: string[] | null;
  preview_url: string | null;
  file_url: string | null;
  created_at: string;
  profile?: {
    username: string | null;
    avatar_url: string | null;
  } | null;
}

// Explicit column list — avoids over-fetching wide/derived columns (e.g. librosa_features)
const SOURCE_COLUMNS =
  'id,user_id,source_type,name,spotify_id,spotify_url,album_name,album_image,artists,preview_url,file_url,created_at';

async function fetchMySourcesData(userId: string): Promise<AudioSource[]> {
  const { data, error } = await supabase
    .from('audio_sources')
    .select(SOURCE_COLUMNS)
    .eq('user_id', userId)
    .order('created_at', { ascending: false });

  if (error) throw error;
  return (data || []) as AudioSource[];
}

async function fetchAllSourcesData(): Promise<AudioSource[]> {
  const { data: sourcesData, error: sourcesError } = await supabase
    .from('audio_sources')
    .select(SOURCE_COLUMNS)
    .order('created_at', { ascending: false })
    .limit(100);

  if (sourcesError) throw sourcesError;

  const userIds = [...new Set((sourcesData || []).map((s) => s.user_id))];
  if (userIds.length === 0) return [];

  const { data: profilesData } = await supabase
    .from('profiles')
    .select('user_id, username, avatar_url')
    .in('user_id', userIds);

  const profileMap = new Map((profilesData || []).map((p) => [p.user_id, p]));

  return (sourcesData || []).map((source) => {
    const profile = profileMap.get(source.user_id);
    return {
      ...source,
      profile: profile ? { username: profile.username, avatar_url: profile.avatar_url } : null,
    };
  }) as AudioSource[];
}

export function useAudioSources() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const { data: mySources = [], isLoading: isLoadingMine } = useQuery({
    queryKey: ['audio-sources', 'mine', user?.id],
    queryFn: () => fetchMySourcesData(user!.id),
    enabled: !!user,
    staleTime: 2 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
  });

  // Reads require an authenticated session (RLS), so skip the request entirely for visitors.
  const { data: allSources = [], isLoading: isLoadingAll } = useQuery({
    queryKey: ['audio-sources', 'all'],
    queryFn: fetchAllSourcesData,
    enabled: !!user,
    staleTime: 5 * 60 * 1000,
    gcTime: 15 * 60 * 1000,
  });

  const loading = !!user && (isLoadingMine || isLoadingAll);

  const refresh = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: ['audio-sources'] });
  }, [queryClient]);

  const saveSpotifyTrack = async (track: any) => {
    if (!user) {
      toast.error('Please sign in to save tracks');
      return { error: new Error('Not authenticated') };
    }

    const existing = mySources.find((s) => s.spotify_id === track.id);
    if (existing) {
      toast.info('Track already in your library');
      return { error: null };
    }

    const { error } = await supabase.from('audio_sources').insert({
      user_id: user.id,
      source_type: 'spotify',
      name: `${track.name} - ${track.artists[0].name}`,
      spotify_id: track.id,
      spotify_url: track.external_urls?.spotify,
      album_name: track.album.name,
      album_image: track.album.images?.[0]?.url,
      artists: track.artists.map((a: any) => a.name),
      preview_url: track.preview_url,
    });

    if (error) {
      toast.error('Failed to save track');
      return { error: new Error(error.message) };
    }

    toast.success('Track saved to your library');
    await refresh();
    return { error: null };
  };

  const saveFileSource = async (file: File, fileUrl?: string) => {
    if (!user) {
      toast.error('Please sign in to save files');
      return { error: new Error('Not authenticated') };
    }

    const { error } = await supabase.from('audio_sources').insert({
      user_id: user.id,
      source_type: 'file',
      name: file.name,
      file_url: fileUrl,
    });

    if (error) {
      toast.error('Failed to save file');
      return { error: new Error(error.message) };
    }

    toast.success('File saved to your library');
    await refresh();
    return { error: null };
  };

  const deleteSource = async (sourceId: string) => {
    if (!user) return { error: new Error('Not authenticated') };

    const { error } = await supabase
      .from('audio_sources')
      .delete()
      .eq('id', sourceId)
      .eq('user_id', user.id);

    if (error) {
      toast.error('Failed to delete source');
      return { error: new Error(error.message) };
    }

    toast.success('Source removed from library');
    await refresh();
    return { error: null };
  };

  return {
    mySources,
    allSources,
    loading,
    saveSpotifyTrack,
    saveFileSource,
    deleteSource,
    refresh,
  };
}
