import { useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";

// Subset of Spotify's audio-features object. See:
// https://developer.spotify.com/documentation/web-api/reference/get-audio-features
export interface SpotifyAudioFeatures {
  id: string;
  tempo: number;            // BPM
  key: number;              // 0-11 pitch class (C, C#, D, ...)
  mode: number;             // 0 = minor, 1 = major
  time_signature: number;   // 3..7
  energy: number;           // 0..1
  valence: number;          // 0..1 (musical positiveness)
  danceability: number;     // 0..1
  acousticness: number;     // 0..1
  instrumentalness: number; // 0..1
  liveness: number;         // 0..1
  speechiness: number;      // 0..1
  loudness: number;         // dB, typically -60..0
  duration_ms: number;
}

interface AudioFeaturesResponse {
  success: boolean;
  features?: SpotifyAudioFeatures[];
  requested?: number;
  returned?: number;
  invalid_inputs?: string[];
  error?: string;
  spotify_unavailable?: boolean;
}

/**
 * Fetch Spotify audio features for one or more track IDs / URLs / URIs.
 * Wraps the `spotify-audio-features` edge function.
 *
 * Use this as a server-free fallback to librosa: tempo, key, energy, valence,
 * danceability, etc. for any Spotify-imported track, with no EC2 dependency.
 */
export function useSpotifyAudioFeatures() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchFeatures = useCallback(
    async (trackIds: string[]): Promise<SpotifyAudioFeatures[] | null> => {
      if (trackIds.length === 0) return [];
      setLoading(true);
      setError(null);
      try {
        const { data, error: invokeError } = await supabase.functions.invoke<
          AudioFeaturesResponse
        >("spotify-audio-features", {
          body: { track_ids: trackIds },
        });
        if (invokeError) {
          setError(invokeError.message);
          return null;
        }
        if (!data?.success) {
          setError(data?.error ?? "Unknown error");
          return null;
        }
        return data.features ?? [];
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Unknown error";
        setError(msg);
        return null;
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  return { fetchFeatures, loading, error };
}
