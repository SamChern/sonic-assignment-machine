import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { invokeWithTimeout } from "@/lib/invokeWithTimeout";
import { runIngestPipeline } from "./runIngestPipeline";
import { toast } from "@/hooks/use-toast";
import {
  PHASE_HISTORY_KEY,
  PHASE_HISTORY_MAX,
  SCORE_WAIT_MS,
  awaitWorkerFiles,
  bytes,
  fileName,
  invokeIngestWithRetry,
} from "@/lib/wizard/helpers";
import type {
  Activation,
  ActivationFile,
  DeadlineInfo,
  IngestDispatchSummary,
  LiveRun,
  PhaseRun,
  ResumeEstimate,
  SCORE_FIELDS,
  StageKey,
  StageResult,
} from "@/lib/wizard/types";

/**
 * All state and network orchestration for the guided ingestion wizard,
 * extracted from the component so the JSX stays focused on presentation.
 * Behaviour, step order, and network calls are unchanged from the original
 * inline implementation.
 */
export function useWizardEngine() {
  const [activations, setActivations] = useState<Activation[]>([]);
  const [selected, setSelected] = useState<string>("");
  const [discovering, setDiscovering] = useState(false);
  const [running, setRunning] = useState(false);
  /** Stages the user chose to expand — collapsed by default (progress bar only). */
  const [expandedStages, setExpandedStages] = useState<StageKey[]>([]);

  /** Files that still have untransformed row groups — the Resume target. */
  const [partialFiles, setPartialFiles] = useState<ActivationFile[]>([]);
  /** Row-group progress + time estimates for the next resume run. */
  const [resumeEstimates, setResumeEstimates] = useState<ResumeEstimate[]>([]);
  /** Budget / deadline telemetry from the last run of each file. */
  const [deadlines, setDeadlines] = useState<DeadlineInfo[]>([]);
  /**
   * Rolling per-phase CPU history across invocations (newest last), kept in
   * localStorage so the chart survives reloads and spans several resume runs.
   */
  const [phaseRuns, setPhaseRuns] = useState<PhaseRun[]>(() => {
    try {
      const raw = localStorage.getItem(PHASE_HISTORY_KEY);
      const parsed = raw ? (JSON.parse(raw) as PhaseRun[]) : [];
      return Array.isArray(parsed) ? parsed.slice(-PHASE_HISTORY_MAX) : [];
    } catch {
      return [];
    }
  });
  /** The call currently in flight, plus a 1s tick for its countdown. */
  const [liveRun, setLiveRun] = useState<LiveRun | null>(null);
  const [, setTick] = useState(0);
  /** Row-group cursor at the start of the previous run, for throughput math. */
  const resumeCursors = useRef<Record<string, number>>({});
  /** Last budget the server reported, used for the countdown before it replies. */
  const lastBudgetMs = useRef(70_000);

  useEffect(() => {
    try {
      localStorage.setItem(PHASE_HISTORY_KEY, JSON.stringify(phaseRuns));
    } catch {
      /* storage full or blocked — the chart is still live for this session */
    }
  }, [phaseRuns]);

  useEffect(() => {
    if (!liveRun) return;
    const id = window.setInterval(() => setTick((t) => t + 1), 1000);
    return () => window.clearInterval(id);
  }, [liveRun]);

  const [results, setResults] = useState<Partial<Record<StageKey, StageResult>>>({});

  const activation = activations.find((a) => a.activation_id === selected);

  const setStage = (key: StageKey, value: StageResult) =>
    setResults((prev) => ({ ...prev, [key]: value }));

  /**
   * Files already recorded in the database, grouped by activation id. Used when
   * bucket listing is unavailable (the delivery credential often has object-read
   * access but no `s3:ListBucket`), so previously-seen deliveries can still be
   * re-run from the wizard.
   */
  const activationsFromLedger = useCallback(async (): Promise<Activation[]> => {
    const { data } = await supabase
      .from("intuizi_ingest_files")
      .select(
        "object_key, report_type, size_bytes, status, total_rows, processed_rows, finished_at, error_message",
      )
      .order("updated_at", { ascending: false })
      .limit(500);

    const groups = new Map<string, Activation>();
    for (const r of data ?? []) {
      const key = String(r.object_key ?? "");
      const id = key.match(/activation[_-]?id[_-]?(\d+)/i)?.[1] ?? "unassigned";
      const group =
        groups.get(id) ??
        ({ activation_id: id, files: [], empty_files: 0, total_bytes: 0, done_files: 0 } as Activation);
      group.files.push({
        object_key: key,
        report_type: r.report_type ?? null,
        size: Number(r.size_bytes ?? 0) || 0,
        prefix: key.split("/").slice(0, -1).join("/"),
        status: r.status ?? null,
        total_rows: r.total_rows == null ? null : Number(r.total_rows),
        processed_rows: r.processed_rows == null ? null : Number(r.processed_rows),
        finished_at: r.finished_at ?? null,
        error_message: r.error_message ?? null,
      });
      group.total_bytes += Number(r.size_bytes ?? 0) || 0;
      if (r.status === "done") group.done_files += 1;
      groups.set(id, group);
    }
    return [...groups.values()].sort((a, b) => b.activation_id.localeCompare(a.activation_id));
  }, []);

  /** Step 0 — list inbound objects grouped by activation id. */
  const discover = useCallback(async () => {
    setDiscovering(true);
    const { data, error } = await invokeWithTimeout<{
      activations?: Activation[];
      errors?: string[];
    }>("intuizi-ingest", { body: { action: "activations" }, timeoutMs: 60_000 });

    let list = error ? [] : (data?.activations ?? []).filter((a) => a.files.length > 0);
    let fromLedger = false;
    if (!list.length) {
      list = await activationsFromLedger();
      fromLedger = list.length > 0;
    }
    setDiscovering(false);

    setActivations(list);
    setResults({});
    if (!list.length) {
      const why = error
        ? error.message
        : data?.errors?.length
          ? data.errors.join("; ")
          : "Nothing is waiting under the Intuizi prefixes.";
      toast({ title: "No inbound objects found", description: why, variant: "destructive" });
      return;
    }
    if (fromLedger) {
      toast({
        title: "Listing from delivery history",
        description:
          "Bucket scanning is unavailable, so these activations come from files already recorded here.",
      });
    }
    if (!list.some((a) => a.activation_id === selected)) setSelected(list[0].activation_id);
  }, [selected, activationsFromLedger]);


  /**
   * Wait for the background scorer to drain this activation's queue.
   *
   * Scoring no longer runs inside the ingest invocation (that is what made runs
   * hit the 150s gateway limit and the worker CPU ceiling). `intuizi-score-worker`
   * processes small batches and self-chains; this only kicks it once and polls
   * progress, so the UI shows live movement without holding an edge function open.
   */
  const drainScoreQueue = useCallback(async (activationId: string) => {
    const counts = async () => {
      const { data } = await supabase
        .from("intuizi_score_queue")
        .select("status")
        .eq("activation_id", activationId);
      const rows = (data ?? []) as { status: string }[];
      const total = rows.length;
      const pending = rows.filter((r) => r.status === "pending" || r.status === "processing").length;
      const failed = rows.filter((r) => r.status === "failed").length;
      const dead = rows.filter((r) => r.status === "dead_letter").length;
      return { total, pending, failed, dead };
    };

    let c = await counts();
    if (c.total === 0) return;

    setStage("score", {
      state: "running",
      summary: `scoring ${c.total - c.pending}/${c.total} identifiers in the background…`,
    });
    // Kick the worker; harmless if a scheduled tick already started it.
    await supabase.functions
      .invoke("intuizi-score-worker", { body: { source: "wizard" } })
      .catch(() => undefined);

    const deadline = Date.now() + SCORE_WAIT_MS;
    while (c.pending > 0 && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 4000));
      c = await counts();
      setStage("score", {
        state: "running",
        summary: `scoring ${c.total - c.pending}/${c.total} identifiers in the background…${
          c.failed ? ` · ${c.failed} failed` : ""
        }${c.dead ? ` · ${c.dead} dead-lettered` : ""}`,
      });
    }
    if (c.pending > 0) {
      setStage("score", {
        state: "warn",
        summary: `${c.total - c.pending}/${c.total} scored so far — the background worker is still running`,
        notes: [
          "Scoring continues on the server even after you leave this page. Re-run the wizard (or reopen it) to see the finished scores.",
        ],
      });
    }
  }, []);

  /** Steps 1-4 — run the semantic pipeline for the given files of the activation. */
  const runFiles = useCallback(async (files: ActivationFile[], resuming = false) => {
    if (!activation) return;
    setRunning(true);
    setResults({});
    await runIngestPipeline(files, resuming, {
      activation,
      setStage,
      setRunning,
      setLiveRun,
      setDeadlines,
      setPhaseRuns,
      setPartialFiles,
      setResumeEstimates,
      lastBudgetMsRef: lastBudgetMs,
      drainScoreQueue,
    });
  }, [activation, drainScoreQueue]);

  const run = useCallback(
    () => runFiles(activation?.files ?? [], false),
    [activation, runFiles],
  );
  const resume = useCallback(() => runFiles(partialFiles, true), [partialFiles, runFiles]);

  return {
    activations,
    selected,
    setSelected,
    discovering,
    running,
    expandedStages,
    setExpandedStages,
    partialFiles,
    resumeEstimates,
    deadlines,
    phaseRuns,
    setPhaseRuns,
    liveRun,
    activation,
    results,
    setResults,
    discover,
    run,
    resume,
  };
}
