/**
 * Live data for the Intuizi Console scoring dashboard.
 *
 * Every query here is deliberately bounded: the scoring queue holds millions of
 * rows, so global depth comes from the capped `intuizi_score_queue_depth` RPC,
 * per-activation totals come from the cached cost snapshot, and only the small
 * in-flight / recently-finished slices are read directly from the queue.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export interface QueueDepth {
  pending_capped: number;
  dead_letter_capped: number;
  capped_at: number;
}

export interface ActivationSnapshot {
  activation_id: string;
  total_rows: number;
  done_rows: number;
  pending_rows: number;
  computed_at: string;
}

export interface QueueItem {
  id: string;
  identifier: string;
  activation_id: string | null;
  status: string;
  attempts: number;
  last_stage: string | null;
  last_error: string | null;
  updated_at: string;
}

export interface WorkerRow {
  worker_id: string;
  host: string | null;
  last_seen: string;
}

export interface ScoringRunsData {
  depth: QueueDepth | null;
  activations: ActivationSnapshot[];
  running: QueueItem[];
  recent: QueueItem[];
  workers: WorkerRow[];
  paused: boolean;
  pauseReason: string | null;
  loading: boolean;
  error: string | null;
  fetchedAt: Date | null;
  reload: () => void;
  live: boolean;
  setLive: (v: boolean) => void;
  /** Actions that actually drive the pipeline. */
  busy: string | null;
  lastRun: string | null;
  start: (activationId?: string) => Promise<void>;
  requeueFailed: (activationId?: string) => Promise<void>;
  setPaused: (next: boolean) => Promise<void>;
}

const QUEUE_COLS =
  "id,identifier,activation_id,status,attempts,last_stage,last_error,updated_at";


export const useScoringRuns = (pollMs = 10000): ScoringRunsData => {
  const [depth, setDepth] = useState<QueueDepth | null>(null);
  const [activations, setActivations] = useState<ActivationSnapshot[]>([]);
  const [running, setRunning] = useState<QueueItem[]>([]);
  const [recent, setRecent] = useState<QueueItem[]>([]);
  const [workers, setWorkers] = useState<WorkerRow[]>([]);
  const [paused, setPaused] = useState(false);
  const [pauseReason, setPauseReason] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [fetchedAt, setFetchedAt] = useState<Date | null>(null);
  const [live, setLive] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [lastRun, setLastRun] = useState<string | null>(null);
  const inFlight = useRef(false);


  const load = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setLoading(true);
    try {
      const [depthRes, cacheRes, runningRes, recentRes, workerRes, stateRes] =
        await Promise.all([
          supabase.rpc("intuizi_score_queue_depth", { p_cap: 100000 }),
          supabase
            .from("intuizi_cost_estimate_cache")
            .select("activation_id,total_rows,done_rows,pending_rows,computed_at")
            .order("total_rows", { ascending: false })
            .limit(10),
          supabase
            .from("intuizi_score_queue")
            .select(QUEUE_COLS)
            .eq("status", "processing")
            .order("updated_at", { ascending: false })
            .limit(50),
          supabase
            .from("intuizi_score_queue")
            .select(QUEUE_COLS)
            .in("status", ["done", "failed", "dead_letter", "skipped"])
            .order("updated_at", { ascending: false })
            .limit(25),
          supabase
            .from("worker_heartbeats")
            .select("worker_id,host,last_seen")
            .order("last_seen", { ascending: false })
            .limit(6),
          supabase
            .from("intuizi_ingest_state")
            .select("paused,pause_reason,parked_until")
            .eq("id", "singleton")
            .maybeSingle(),

        ]);

      const firstError =
        depthRes.error ?? cacheRes.error ?? runningRes.error ?? recentRes.error;
      setError(firstError ? firstError.message : null);

      const d = Array.isArray(depthRes.data) ? depthRes.data[0] : depthRes.data;
      if (d) setDepth(d as QueueDepth);
      setActivations((cacheRes.data ?? []) as ActivationSnapshot[]);
      setRunning((runningRes.data ?? []) as QueueItem[]);
      setRecent((recentRes.data ?? []) as QueueItem[]);
      setWorkers((workerRes.data ?? []) as WorkerRow[]);
      const parked = stateRes.data?.parked_until
        ? new Date(stateRes.data.parked_until as string) > new Date()
        : false;
      setPaused(!!stateRes.data?.paused || parked);
      setPauseReason(
        stateRes.data?.pause_reason ??
          (parked ? "Waiting out a rate-limit cool-down." : null),
      );
      setFetchedAt(new Date());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not read scoring runs.");
    } finally {
      setLoading(false);
      inFlight.current = false;
    }
  }, []);

  /** One place for every pipeline-driving call to the scoring worker. */
  const invokeWorker = useCallback(
    async (label: string, body: Record<string, unknown>) => {
      setBusy(label);
      setError(null);
      try {
        const { data, error: fnErr } = await supabase.functions.invoke(
          "intuizi-score-worker",
          { body },
        );
        if (fnErr) throw fnErr;
        const res = (data ?? {}) as {
          success?: boolean;
          error?: string;
          scored?: number;
          materialized?: number;
          failed?: number;
          pending?: number;
          requeued?: number;
          chained?: boolean;
          skipped?: string;
        };
        if (res.success === false) throw new Error(res.error ?? "Worker refused the run.");
        if (typeof res.requeued === "number") {
          setLastRun(`Put ${res.requeued.toLocaleString()} item(s) back in the queue.`);
        } else if (res.skipped) {
          setLastRun(`Worker skipped: ${res.skipped}.`);
        } else if (typeof res.scored === "number") {
          setLastRun(
            `Scored ${(res.scored ?? 0).toLocaleString()}, reused ${(res.materialized ?? 0)
              .toLocaleString()}, failed ${(res.failed ?? 0).toLocaleString()}. ${
              res.chained ? "Still working through the queue." : "Queue drained for now."
            }`,
          );
        } else {
          setLastRun("Done.");
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "The scoring worker could not be reached.");
      } finally {
        setBusy(null);
        load();
      }
    },
    [load],
  );

  const start = useCallback(
    (activationId?: string) =>
      invokeWorker("start", {
        source: "console",
        ...(activationId ? { activation_id: activationId } : {}),
      }),
    [invokeWorker],
  );

  const requeueFailed = useCallback(
    (activationId?: string) =>
      invokeWorker("requeue", {
        action: "requeue_failed",
        source: "console",
        include_dead_letter: true,
        ...(activationId ? { activation_id: activationId } : {}),
      }),
    [invokeWorker],
  );

  const setPausedState = useCallback(
    (next: boolean) =>
      invokeWorker(next ? "pause" : "resume", {
        action: next ? "pause" : "resume",
        source: "console",
        reason: "Paused from the Intuizi Console",
      }),
    [invokeWorker],
  );

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!live) return;
    const t = setInterval(load, pollMs);
    return () => clearInterval(t);
  }, [live, pollMs, load]);

  return {
    depth,
    activations,
    running,
    recent,
    workers,
    paused,
    pauseReason,
    loading,
    error,
    fetchedAt,
    reload: load,
    live,
    setLive,
    busy,
    lastRun,
    start,
    requeueFailed,
    setPaused: setPausedState,
  };

};
