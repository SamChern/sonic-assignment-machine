import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "./useAuth";

export interface AudioJob {
  id: string;
  kind: string;
  status: "pending" | "processing" | "done" | "failed" | string;
  attempts: number;
  last_error: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  audio_source_id: string | null;
  source_name: string | null;
  source_status: string | null;
  queue_position: number | null;
  progress: number;
}

export interface WorkerState {
  paused: boolean;
  pause_reason: string | null;
  paused_at: string | null;
  last_kick_at: string | null;
  last_error: string | null;
  busy: boolean;
}

const ACTIVE_POLL_MS = 5000;
const IDLE_POLL_MS = 60000;

/**
 * Background audio job status.
 *
 * Reads public.analysis_jobs through the analysis-job-status endpoint, which
 * also nudges the worker when the caller has pending work. Polling is
 * visibility-aware and slows right down when nothing is in flight, so an open
 * tab costs almost nothing.
 */
export function useAudioJobs(options?: { allUsers?: boolean; limit?: number }) {
  const { user } = useAuth();
  const [jobs, setJobs] = useState<AudioJob[]>([]);
  const [worker, setWorker] = useState<WorkerState | null>(null);
  const [queueDepth, setQueueDepth] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<number | null>(null);
  const inFlight = useRef(false);

  const allUsers = options?.allUsers ?? false;
  const limit = options?.limit ?? 25;

  const refresh = useCallback(
    async (kick = true) => {
      if (!user || inFlight.current) return;
      inFlight.current = true;
      setLoading(true);
      try {
        const { data, error: fnError } = await supabase.functions.invoke(
          "analysis-job-status",
          { body: { all_users: allUsers, limit, kick } },
        );
        if (fnError) throw new Error(fnError.message);
        if (data?.error) throw new Error(data.error);
        setJobs((data?.jobs ?? []) as AudioJob[]);
        setWorker((data?.worker ?? null) as WorkerState | null);
        setQueueDepth(Number(data?.queue_depth ?? 0));
        setError(null);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load job status");
      } finally {
        inFlight.current = false;
        setLoading(false);
      }
    },
    [user, allUsers, limit],
  );

  const activeCount = jobs.filter(
    (j) => j.status === "pending" || j.status === "processing",
  ).length;

  useEffect(() => {
    if (!user) {
      setJobs([]);
      return;
    }

    let cancelled = false;

    const tick = async () => {
      if (cancelled) return;
      if (document.visibilityState === "visible") {
        await refresh(true);
      }
      if (cancelled) return;
      const delay = activeCount > 0 ? ACTIVE_POLL_MS : IDLE_POLL_MS;
      timer.current = window.setTimeout(tick, delay);
    };

    void tick();

    const onVisible = () => {
      if (document.visibilityState === "visible") void refresh(true);
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      cancelled = true;
      if (timer.current) window.clearTimeout(timer.current);
      document.removeEventListener("visibilitychange", onVisible);
    };
    // activeCount drives the poll cadence: fast while work is in flight.
  }, [user, refresh, activeCount]);

  return { jobs, worker, queueDepth, activeCount, loading, error, refresh };
}
