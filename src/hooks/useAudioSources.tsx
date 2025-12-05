import { useState, useEffect, useCallback } from 'react';
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

export function useAudioSources() {
  const { user } = useAuth();
  const [mySources, setMySources] = useState<AudioSource[]>([]);
  const [allSources, setAllSources] = useState<AudioSource[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchMySources = useCallback(async () => {
    if (!user) {
      setMySources([]);
      return;
    }

    const { data, error } = await supabase
      .from('audio_sources')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Error fetching my sources:', error);
    } else {
      setMySources(data || []);
    }
  }, [user]);

  const fetchAllSources = useCallback(async () => {
    // First get audio sources
    const { data: sourcesData, error: sourcesError } = await supabase
      .from('audio_sources')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(100);

    if (sourcesError) {
      console.error('Error fetching all sources:', sourcesError);
      setLoading(false);
      return;
    }

    // Then get profiles for those users
    const userIds = [...new Set(sourcesData?.map(s => s.user_id) || [])];
    const { data: profilesData } = await supabase
      .from('profiles')
      .select('user_id, username, avatar_url')
      .in('user_id', userIds);

    // Merge profile data with sources
    const sourcesWithProfiles = (sourcesData || []).map(source => ({
      ...source,
      profile: profilesData?.find(p => p.user_id === source.user_id) || null,
    }));

    setAllSources(sourcesWithProfiles);
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchMySources();
    fetchAllSources();
  }, [fetchMySources, fetchAllSources]);

  const saveSpotifyTrack = async (track: any) => {
    if (!user) {
      toast.error('Please sign in to save tracks');
      return { error: new Error('Not authenticated') };
    }

    // Check if already saved
    const existing = mySources.find(s => s.spotify_id === track.id);
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
    fetchMySources();
    fetchAllSources();
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
    fetchMySources();
    fetchAllSources();
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
    fetchMySources();
    fetchAllSources();
    return { error: null };
  };

  return {
    mySources,
    allSources,
    loading,
    saveSpotifyTrack,
    saveFileSource,
    deleteSource,
    refresh: () => {
      fetchMySources();
      fetchAllSources();
    },
  };
}
