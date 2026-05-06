import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export interface LibrosaScalars {
  tempo_bpm: number;
  beat_regularity: number;
  onset_rate_per_sec: number;
  estimated_key: string;
  mode: "major" | "minor";
  key_confidence: number;
  rms_mean: number;
  rms_std: number;
  spectral_centroid_mean: number;
  spectral_centroid_std: number;
  spectral_rolloff_mean: number;
  spectral_bandwidth_mean: number;
  spectral_flatness_mean: number;
  spectral_contrast_mean: number[];
  zero_crossing_rate_mean: number;
  mfcc_mean: number[];
  mfcc_std: number[];
  delta_mfcc_mean: number[];
  delta_mfcc_std: number[];
  chroma_mean: number[];
  tonnetz_mean: number[];
  tonnetz_std: number[];
}

export interface LibrosaVisualsBlob {
  times: number[];
  mel_db: number[][];
  mfcc: number[][];
  chroma: number[][];
  onset_envelope: number[];
  beat_times: number[];
  segment_times: number[];
  recurrence: number[][];
}

export interface LibrosaFeatures {
  ok: boolean;
  elapsed_ms: number;
  sample_rate: number;
  duration_sec: number;
  scalars: LibrosaScalars;
  visuals: LibrosaVisualsBlob;
}

interface InvokeArgs {
  audio_source_id?: string;
  audio_url?: string;
  audio_b64?: string;
  youtube_url?: string;
  duration?: number;
  n_mfcc?: number;
  max_frames?: number;
  recurrence_size?: number;
}

/**
 * Fetches (and caches) the rich librosa feature blob for an audio source.
 * If `audio_source_id` is provided, the edge function returns the cached blob
 * from `audio_sources.librosa_features` when present and persists fresh runs.
 */
export function useLibrosaFeatures() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [features, setFeatures] = useState<LibrosaFeatures | null>(null);
  const [cached, setCached] = useState<boolean>(false);

  const run = useCallback(async (args: InvokeArgs): Promise<LibrosaFeatures | null> => {
    setLoading(true);
    setError(null);
    try {
      const { data, error: invokeErr } = await supabase.functions.invoke<{
        success: boolean;
        cached?: boolean;
        result?: LibrosaFeatures;
        error?: string;
      }>("librosa-analyze-full", { body: args });
      if (invokeErr) {
        setError(invokeErr.message);
        return null;
      }
      if (!data?.success || !data.result) {
        setError(data?.error ?? "Unknown error");
        return null;
      }
      setFeatures(data.result);
      setCached(!!data.cached);
      return data.result;
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Unknown";
      setError(msg);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  return { features, cached, loading, error, run, setFeatures };
}

/** Fetch a previously-computed librosa_features blob directly from the table. */
export function useStoredLibrosaFeatures(audioSourceId: string | null | undefined) {
  const [features, setFeatures] = useState<LibrosaFeatures | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!audioSourceId) return;
      setLoading(true);
      const { data } = await supabase
        .from("audio_sources")
        .select("librosa_features")
        .eq("id", audioSourceId)
        .maybeSingle();
      if (cancelled) return;
      setFeatures((data?.librosa_features as LibrosaFeatures | null) ?? null);
      setLoading(false);
    }
    load();
    return () => { cancelled = true; };
  }, [audioSourceId]);

  return { features, loading };
}
