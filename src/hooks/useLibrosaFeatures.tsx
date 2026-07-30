import { useCallback, useEffect, useRef, useState } from "react";
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

export type AnalysisStatus = "idle" | "queued" | "processing" | "ready" | "failed";

interface InvokeArgs {
  audio_source_id?: string;
  audio_url?: string;
  audio_b64?: string;
  youtube_url?: string;
  /** Provider track id (Spotify/Apple). Lets identical tracks share one cache entry. */
  identity?: string;
  /**
   * "fast" (default) asks the analysis service for scalars only — far less CPU.
   * "full" requests the heavy visuals and should only be used when the visuals
   * are actually being opened.
   */
  profile?: "fast" | "full";
  /** Enqueue instead of waiting inline. */
  async?: boolean;
  duration?: number;
  n_mfcc?: number;
  max_frames?: number;
  recurrence_size?: number;
}

interface InvokeResponse {
  success: boolean;
  cached?: boolean;
  queued?: boolean;
  degraded?: boolean;
  job_id?: string;
  cache_key?: string;
  result?: LibrosaFeatures;
  message?: string;
  error?: string;
}

const RETRYABLE = [429, 502, 503, 504];

/**
 * Serializes every librosa request in the browser tab. The upstream analysis
 * service handles one job at a time, so firing a batch in parallel only
 * produces rate-limit errors.
 */
let chain: Promise<unknown> = Promise.resolve();
function serialize<T>(task: () => Promise<T>): Promise<T> {
  const next = chain.then(task, task);
  chain = next.catch(() => {});
  return next;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function invokeWithBackoff(args: InvokeArgs): Promise<InvokeResponse> {
  let lastError = "Unknown error";
  for (let attempt = 0; attempt < 3; attempt++) {
    const { data, error } = await supabase.functions.invoke<InvokeResponse>(
      "librosa-analyze-full",
      { body: args },
    );

    if (!error) return data ?? { success: false, error: "Empty response" };

    const status = (error as { context?: { status?: number } }).context?.status;
    lastError = error.message;
    if (!status || !RETRYABLE.includes(status)) {
      return { success: false, error: lastError };
    }
    await sleep(800 * 2 ** attempt);
  }
  return { success: false, error: lastError };
}

/**
 * Fetches (and caches) the librosa feature blob for an audio source.
 *
 * Requests are content-addressed and cached server-side, so a track already
 * analyzed by anyone returns instantly. When the analysis service is busy or
 * unavailable the request is queued and this hook polls for completion instead
 * of blocking the user.
 */
export function useLibrosaFeatures() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [features, setFeatures] = useState<LibrosaFeatures | null>(null);
  const [cached, setCached] = useState(false);
  const [status, setStatus] = useState<AnalysisStatus>("idle");
  const [queueMessage, setQueueMessage] = useState<string | null>(null);
  const cancelled = useRef(false);

  useEffect(() => () => { cancelled.current = true; }, []);

  const pollJob = useCallback(
    async (jobId: string, cacheKey?: string): Promise<LibrosaFeatures | null> => {
      for (let i = 0; i < 60; i++) {
        if (cancelled.current) return null;
        await sleep(i < 10 ? 2000 : 5000);

        const { data: job } = await supabase
          .from("analysis_jobs")
          .select("status, last_error")
          .eq("id", jobId)
          .maybeSingle();

        if (job?.status === "processing") setStatus("processing");

        if (job?.status === "failed") {
          setStatus("failed");
          setError(job.last_error ?? "Analysis failed");
          return null;
        }

        if (job?.status === "done" && cacheKey) {
          const { data: row } = await supabase
            .from("librosa_cache")
            .select("features")
            .eq("cache_key", cacheKey)
            .maybeSingle();
          const blob = (row?.features as unknown as LibrosaFeatures | null) ?? null;
          if (blob) {
            setFeatures(blob);
            setStatus("ready");
            return blob;
          }
        }
      }
      setError("Analysis timed out in the queue");
      setStatus("failed");
      return null;
    },
    [],
  );

  const run = useCallback(
    (args: InvokeArgs): Promise<LibrosaFeatures | null> =>
      serialize(async () => {
        setLoading(true);
        setError(null);
        setQueueMessage(null);
        setStatus("processing");
        try {
          const data = await invokeWithBackoff(args);

          if (!data.success) {
            setError(data.error ?? "Unknown error");
            setStatus("failed");
            return null;
          }

          if (data.queued && data.job_id) {
            setStatus("queued");
            setQueueMessage(
              data.message ??
                (data.degraded
                  ? "Analysis service unavailable — queued for retry."
                  : "Analysis queued."),
            );
            return await pollJob(data.job_id, data.cache_key);
          }

          if (!data.result) {
            setError(data.error ?? "No result returned");
            setStatus("failed");
            return null;
          }

          setFeatures(data.result);
          setCached(!!data.cached);
          setStatus("ready");
          return data.result;
        } catch (e) {
          setError(e instanceof Error ? e.message : "Unknown");
          setStatus("failed");
          return null;
        } finally {
          setLoading(false);
        }
      }),
    [pollJob],
  );

  return {
    features,
    cached,
    loading,
    error,
    status,
    queueMessage,
    run,
    setFeatures,
  };
}

/** Fetch a previously-computed librosa_features blob directly from the table. */
export function useStoredLibrosaFeatures(audioSourceId: string | null | undefined) {
  const [features, setFeatures] = useState<LibrosaFeatures | null>(null);
  const [status, setStatus] = useState<AnalysisStatus>("idle");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let stop = false;
    async function load() {
      if (!audioSourceId) return;
      setLoading(true);
      const { data } = await supabase
        .from("audio_sources")
        .select("librosa_features, analysis_status")
        .eq("id", audioSourceId)
        .maybeSingle();
      if (stop) return;
      setFeatures((data?.librosa_features as unknown as LibrosaFeatures | null) ?? null);
      setStatus(((data?.analysis_status as AnalysisStatus) ?? "idle"));
      setLoading(false);
    }
    load();

    // 1.5 — live progress while a queued job is running.
    const channel = supabase
      .channel(`audio_source_${audioSourceId}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "audio_sources",
          filter: `id=eq.${audioSourceId}`,
        },
        (payload) => {
          const row = payload.new as Record<string, unknown>;
          setStatus((row.analysis_status as AnalysisStatus) ?? "idle");
          if (row.librosa_features) {
            setFeatures(row.librosa_features as unknown as LibrosaFeatures);
          }
        },
      )
      .subscribe();

    return () => {
      stop = true;
      supabase.removeChannel(channel);
    };
  }, [audioSourceId]);

  return { features, status, loading };
}
