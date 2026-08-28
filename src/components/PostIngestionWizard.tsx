import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import InferenceConfigGuard from "@/components/InferenceConfigGuard";
import PhaseCpuChart, { type PhaseRun } from "@/components/PhaseCpuChart";
import ScoreQueueHealthPanel from "@/components/ScoreQueueHealthPanel";
import { useInferenceReadiness } from "@/hooks/useInferenceReadiness";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/hooks/use-toast";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  CircleDashed,
  Loader2,
  Play,
  RefreshCw,
  Search,
  Wand2,
} from "lucide-react";


/* ------------------------------------------------------------------ types */

interface ActivationFile {
  object_key: string;
  report_type: string | null;
  size: number;
  prefix: string;
  status: string | null;
  total_rows: number | null;
  processed_rows: number | null;
  finished_at: string | null;
  error_message: string | null;
}

interface Activation {
  activation_id: string;
  files: ActivationFile[];
  empty_files: number;
  total_bytes: number;
  done_files: number;
}

/** Per-file resume forecast shown while an ingestion is partial. */
interface ResumeEstimate {
  key: string;
  cursor: number;
  total: number | null;
  groupsRemaining: number | null;
  groupsNextRun: number | null;
  etaMs: number | null;
  runsRemaining: number | null;
}

/** What the last edge-function run reported about its own time budget. */
interface DeadlineInfo {
  key: string;
  budgetMs: number;
  defaultBudgetMs: number | null;
  budgetReason: string | null;
  elapsedMs: number | null;
  timeRemainingMs: number | null;
  deadlineExceeded: boolean;
  deadlineStep: string | null;
  phaseMs: Record<string, number> | null;
}

/** In-flight run, used to tick a live "aborts in Ns" countdown. */
interface LiveRun {
  key: string;
  startedAt: number;
  budgetMs: number;
}

/**
 * What one control-plane run reports back. Since the transform moved to the EC2
 * DuckDB worker, a run reports the HAND-OFF (dispatch) — row counts arrive later
 * through the worker callback, which is why the wizard then watches the ledger.
 */
interface IngestDispatchSummary {
  trace_id?: string;
  mode?: string;
  files_dispatched?: number;
  files_failed?: number;
  audio_files_scored?: number;
  paused?: boolean;
  pause_reason?: string | null;
  time_budget_exhausted?: boolean;
  complete?: boolean;
  run_budget_ms?: number;
  default_run_budget_ms?: number;
  budget_reason?: string;
  elapsed_ms?: number;
  time_remaining_ms?: number;
  memory_pressure?: boolean;
  phase_ms?: Record<string, number>;
  phase_usage?: Record<string, { ms?: number; heap_delta_mb?: number; peak_heap_mb?: number }>;
  queue?: { visible?: number; in_flight?: number; delayed?: number; error?: string };
  work_caps?: { rows?: number; files?: number; shrink?: number; reason?: string };
  files?: {
    object_key?: string;
    status?: string;
    trace_id?: string | null;
    message_id?: string | null;
    row_group_cursor?: number | null;
    row_groups_total?: number | null;
  }[];
  errors?: string[];
}

/** Ledger row the wizard polls while the off-platform worker transforms a file. */
interface LedgerRow {
  object_key: string;
  status: string;
  processed_rows: number | null;
  total_rows: number | null;
  row_group_cursor: number | null;
  row_groups_total: number | null;
  error_message: string | null;
  heartbeat_at: string | null;
}


type StageState = "idle" | "running" | "ok" | "warn" | "error";

interface StageResult {
  state: StageState;
  summary: string;
  /** Rendered as a compact key/value output grid. */
  outputs?: [string, string][];
  notes?: string[];
}

const PHASE_HISTORY_KEY = "sonicsim.ingest.phaseCpuHistory.v1";
/** How long the wizard waits on the background scorer before handing off. */
const SCORE_WAIT_MS = 4 * 60_000;

const PHASE_HISTORY_MAX = 12;

const STAGES = [
  ["discover", "Discover delivery"],
  ["ingest", "Ingest + normalize"],
  ["source", "Source + taxonomy tags"],
  ["score", "Semantic scoring"],
  ["link", "Audience linkage"],
] as const;


type StageKey = typeof STAGES[number][0];

const SCORE_FIELDS = [
  ["emotional_score", "Emotional"],
  ["cognitive_score", "Cognitive"],
  ["social_score", "Social"],
  ["communication_score", "Communication"],
  ["contextual_score", "Contextual"],
  ["artistic_score", "Artistic"],
] as const;

const bytes = (n: number) =>
  n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`;

const fileName = (key: string) => key.split("/").pop() ?? key;

/** Compact ms -> "45s" / "3m 20s" for resume time estimates. */
const fmtDuration = (ms: number) => {
  const s = Math.max(1, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return rem ? `${m}m ${rem}s` : `${m}m`;
};

const StageIcon = ({ state }: { state: StageState }) => {
  if (state === "running") return <Loader2 className="h-4 w-4 animate-spin text-primary" />;
  if (state === "ok") return <CheckCircle2 className="h-4 w-4 text-primary" />;
  if (state === "warn") return <AlertTriangle className="h-4 w-4 text-amber-500" />;
  if (state === "error") return <AlertTriangle className="h-4 w-4 text-destructive" />;
  return <CircleDashed className="h-4 w-4 text-muted-foreground" />;
};


/** Shrink factors used when a run is killed for exceeding compute limits. */
const RESOURCE_RETRY_SHRINK = [0.5, 0.25];

/** True when an invoke failure is the worker compute kill (546 / CPU or memory). */
const isResourceLimit = (message: string, detail: string) => {
  const t = `${message} ${detail}`.toUpperCase();
  return t.includes("WORKER_RESOURCE_LIMIT") || t.includes("546") ||
    t.includes("CPU TIME") || t.includes("COMPUTE RESOURCES") || t.includes("MEMORY LIMIT");
};

/**
 * Invoke the ingest function for one file, retrying ONLY the unfinished chunk
 * with a smaller workload when the worker is killed for compute limits.
 * Each retry resumes from the persisted row-group cursor, so no work repeats.
 */
async function invokeIngestWithRetry(
  body: Record<string, unknown>,
  onRetry?: (attempt: number, shrink: number, detail: string) => void,
) {
  let lastError: { message: string; detail: string } | null = null;
  for (let attempt = 0; attempt <= RESOURCE_RETRY_SHRINK.length; attempt++) {
    const shrink = attempt === 0 ? undefined : RESOURCE_RETRY_SHRINK[attempt - 1];
    const { data, error } = await supabase.functions.invoke("intuizi-ingest", {
      body: shrink ? { ...body, shrink, after_resource_limit: true } : body,
    });
    if (!error) return { data, error: null, retries: attempt, shrink };
    let detail = "";
    try {
      const ctx = (error as { context?: { text?: () => Promise<string> } }).context;
      if (ctx?.text) detail = await ctx.text();
    } catch { /* body already consumed */ }
    lastError = { message: error.message, detail };
    const next = RESOURCE_RETRY_SHRINK[attempt];
    if (!isResourceLimit(error.message, detail) || next === undefined) break;
    onRetry?.(attempt + 1, next, detail);
  }
  return { data: null, error: lastError, retries: RESOURCE_RETRY_SHRINK.length, shrink: undefined };
}

/* ------------------------------------------------------------- component */

const PostIngestionWizard = () => {
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

  const {
    readiness,
    loading: inferenceLoading,
    error: inferenceError,
    blocked: inferenceBlocked,
    recheck,
  } = useInferenceReadiness();
  const [results, setResults] = useState<Partial<Record<StageKey, StageResult>>>({});

  const activation = useMemo(
    () => activations.find((a) => a.activation_id === selected),
    [activations, selected],
  );

  const setStage = (key: StageKey, value: StageResult) =>
    setResults((prev) => ({ ...prev, [key]: value }));

  /** Step 0 — list inbound objects grouped by activation id. */
  const discover = useCallback(async () => {
    setDiscovering(true);
    const { data, error } = await supabase.functions.invoke("intuizi-ingest", {
      body: { action: "activations" },
    });
    setDiscovering(false);

    if (error) {
      toast({ title: "Could not list activations", description: error.message, variant: "destructive" });
      return;
    }
    const list = ((data as { activations?: Activation[] })?.activations ?? []).filter(
      (a) => a.files.length > 0,
    );
    setActivations(list);
    setResults({});
    if (!list.length) {
      toast({ title: "No inbound objects found", description: "Nothing is waiting under the Intuizi prefixes." });
      return;
    }
    if (!list.some((a) => a.activation_id === selected)) setSelected(list[0].activation_id);
  }, [selected]);



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

    const dataFiles = files.filter((f) => f.size > 64);
    const emptyFiles = files.filter((f) => f.size <= 64);

    // --- Stage: discover ---------------------------------------------------
    setStage("discover", {
      state: dataFiles.length ? "ok" : "warn",
      summary: dataFiles.length
        ? `${resuming ? "resuming " : ""}${dataFiles.length} file${dataFiles.length === 1 ? "" : "s"} with rows · ${bytes(activation.total_bytes)}`
        : "every file in this activation is header-only — nothing to process",
      outputs: files.map((f) => [
        fileName(f.object_key),
        `${f.report_type ?? "?"} · ${bytes(f.size)}${f.size <= 64 ? " · empty" : ""}`,
      ]),
      notes: emptyFiles.length
        ? [`${emptyFiles.length} header-only file(s) skipped — re-export these from the Intuizi console.`]
        : undefined,
    });

    if (!dataFiles.length) {
      setRunning(false);
      return;
    }

    // --- Stage: dispatch + worker transform --------------------------------
    // The edge function is a control plane now: it hands each file to the EC2
    // DuckDB worker over the queue and returns in milliseconds. The transform
    // itself happens off-platform and reports back, so this stage dispatches and
    // then watches the ledger instead of holding an edge invocation open.
    setStage("ingest", { state: "running", summary: "handing files to the ingest worker…" });
    const perFile: [string, string][] = [];
    const ingestErrors: string[] = [];
    const dispatchedKeys: string[] = [];
    let dispatched = 0;

    const deadlineInfos: DeadlineInfo[] = [];
    const phaseSamples: PhaseRun[] = [];

    for (const f of dataFiles) {
      const t0 = Date.now();
      setLiveRun({ key: f.object_key, startedAt: t0, budgetMs: lastBudgetMs.current });
      const { data, error, retries, shrink } = await invokeIngestWithRetry(
        { object_key: f.object_key, report_type: f.report_type ?? undefined },
        (attempt, nextShrink) => {
          ingestErrors.push(
            `${fileName(f.object_key)}: the dispatch run hit a compute limit — retry ${attempt} re-dispatches at ${Math.round(nextShrink * 100)}% row slice.`,
          );
          setLiveRun({ key: f.object_key, startedAt: Date.now(), budgetMs: lastBudgetMs.current });
        },
      );
      setLiveRun(null);
      const wallMs = Date.now() - t0;
      if (retries > 0 && !error) {
        perFile.push([
          fileName(f.object_key),
          `dispatched after ${retries} retr${retries === 1 ? "y" : "ies"} at ${Math.round((shrink ?? 1) * 100)}% row slice`,
        ]);
      }
      if (error) {
        ingestErrors.push(`${fileName(f.object_key)}: ${error.message}`);
        perFile.push([fileName(f.object_key), "not dispatched · retryable"]);
        deadlineInfos.push({
          key: f.object_key,
          budgetMs: lastBudgetMs.current,
          defaultBudgetMs: null,
          budgetReason: null,
          elapsedMs: wallMs,
          timeRemainingMs: 0,
          deadlineExceeded: true,
          deadlineStep: "dispatch failed — the queue rejected the hand-off",
          phaseMs: null,
        });
        continue;
      }
      const res = data as IngestDispatchSummary;

      if (res.errors?.length) ingestErrors.push(...res.errors);
      if (res.paused) {
        ingestErrors.push(
          `Ingest is paused: ${res.pause_reason ?? "see the queue status panel"}. Resolve it and re-run — nothing is lost.`,
        );
      }

      const fileState = res.files?.find((x) => x.object_key === f.object_key);
      if (fileState?.status === "enqueued") {
        dispatched++;
        dispatchedKeys.push(f.object_key);
      }
      if (res.audio_files_scored) {
        perFile.push([fileName(f.object_key), "audio object analysed inline"]);
      }

      const budgetMs = res.run_budget_ms ?? 30_000;
      lastBudgetMs.current = budgetMs;
      deadlineInfos.push({
        key: f.object_key,
        budgetMs,
        defaultBudgetMs: res.default_run_budget_ms ?? null,
        budgetReason: res.budget_reason ?? null,
        elapsedMs: res.elapsed_ms ?? wallMs,
        timeRemainingMs: res.time_remaining_ms ?? null,
        deadlineExceeded: Boolean(res.time_budget_exhausted),
        deadlineStep: res.time_budget_exhausted ? "run budget reached during discovery" : null,
        phaseMs: res.phase_ms ?? null,
      });

      // Per-phase CPU/heap sample for the chart. Prefer the richer phase_usage
      // payload and fall back to phase_ms when only durations came back.
      const usage = res.phase_usage ?? null;
      const phases: PhaseRun["phases"] = {};
      if (usage) {
        for (const [phase, u] of Object.entries(usage)) {
          if (!u?.ms) continue;
          phases[phase] = {
            ms: u.ms,
            peakHeapMb: u.peak_heap_mb ?? null,
            heapDeltaMb: u.heap_delta_mb ?? null,
          };
        }
      } else if (res.phase_ms) {
        for (const [phase, ms] of Object.entries(res.phase_ms)) {
          if (ms > 0) phases[phase] = { ms, peakHeapMb: null, heapDeltaMb: null };
        }
      }
      if (Object.keys(phases).length) {
        phaseSamples.push({
          key: f.object_key,
          at: Date.now(),
          elapsedMs: res.elapsed_ms ?? wallMs,
          phases,
          resourceLimit: retries > 0,
          memoryPressure: Boolean(res.memory_pressure),
          culprit: null,
        });
      }

      if (fileState?.status === "enqueued") {
        const resumeNote = (fileState.row_group_cursor ?? 0) > 0
          ? ` · resuming at row group ${fileState.row_group_cursor}`
          : "";
        perFile.push([
          fileName(f.object_key),
          `queued for the worker${resumeNote} · trace ${(fileState.trace_id ?? res.trace_id ?? "").slice(-10)}`,
        ]);
      }
    }

    setDeadlines(deadlineInfos);
    if (phaseSamples.length) {
      setPhaseRuns((prev) => [...prev, ...phaseSamples].slice(-PHASE_HISTORY_MAX));
    }

    setStage("ingest", {
      state: ingestErrors.length ? (dispatched ? "warn" : "error") : "running",
      summary: dispatched
        ? `${dispatched} file(s) handed to the ingest worker — waiting for the transform…`
        : "no file was handed off",
      outputs: perFile,
      notes: ingestErrors.length ? ingestErrors : undefined,
    });

    // Watch the ledger while the worker decodes and normalizes off-platform.
    const ledger = dispatchedKeys.length
      ? await awaitWorkerFiles(dispatchedKeys, (rows) => {
        const done = rows.filter((r) => r.status === "done").length;
        const readSoFar = rows.reduce((n, r) => n + (r.processed_rows ?? 0), 0);
        setStage("ingest", {
          state: "running",
          summary: `worker transforming · ${done}/${rows.length} file(s) complete · ${readSoFar.toLocaleString()} rows normalized`,
          outputs: perFile,
          notes: ingestErrors.length ? ingestErrors : undefined,
        });
      })
      : [];

    const stillPartial = dataFiles.filter((f) => {
      const row = ledger.find((r) => r.object_key === f.object_key);
      return row ? row.status !== "done" : dispatchedKeys.includes(f.object_key);
    });
    const rowsRead = ledger.reduce((n, r) => n + (r.processed_rows ?? 0), 0);
    const failedLedger = ledger.filter((r) => r.status === "failed");
    for (const r of failedLedger) {
      ingestErrors.push(`${fileName(r.object_key)}: worker reported ${r.error_message ?? "a failure"}`);
    }

    const estimates: ResumeEstimate[] = ledger
      .filter((r) => r.status !== "done")
      .map((r) => {
        const total = r.row_groups_total ?? null;
        const cursor = r.row_group_cursor ?? 0;
        return {
          key: r.object_key,
          cursor,
          total,
          groupsRemaining: total != null ? Math.max(0, total - cursor) : null,
          groupsNextRun: null,
          etaMs: null,
          runsRemaining: null,
        };
      });

    setPartialFiles(stillPartial);
    setResumeEstimates(estimates);

    for (const r of ledger) {
      perFile.push([
        fileName(r.object_key),
        `${(r.processed_rows ?? 0).toLocaleString()} rows normalized${
          r.row_groups_total != null ? ` · row group ${r.row_group_cursor ?? 0}/${r.row_groups_total}` : ""
        } · ${r.status}`,
      ]);
    }

    setStage("ingest", {
      state: ingestErrors.length || stillPartial.length ? (rowsRead ? "warn" : "error") : "ok",
      summary: `${rowsRead.toLocaleString()} rows normalized by the worker · ${
        stillPartial.length ? `${stillPartial.length} file(s) still in flight` : "all files complete"
      }`,
      outputs: perFile,
      notes: ingestErrors.length ? ingestErrors : undefined,
    });

    // --- Background scoring -----------------------------------------------
    // Ingest only enqueues scoring work now, so wait for `intuizi-score-worker`
    // to drain this activation's queue before reading scores. The worker
    // self-chains, so this is a read-only poll that never blocks the run budget.
    await drainScoreQueue(activation.activation_id);

    // --- Stage: source + tags ---------------------------------------------
    setStage("source", { state: "running", summary: "resolving activation profile…" });
    const { data: profileRow } = await supabase
      .from("intuizi_identifiers")
      .select("audio_source_id")
      .eq("primary_identifier", `activation:${activation.activation_id}`)
      .maybeSingle();
    const sourceId = profileRow?.audio_source_id ?? null;

    if (!sourceId) {
      setStage("source", {
        state: "warn",
        summary: "no activation profile was created",
        notes: [
          "This delivery carried no taxonomy content (device rosters only), so there is nothing to score. Ingest the matching summary or signals report for this activation id.",
        ],
      });
      setStage("score", { state: "idle", summary: "waiting on a scored profile" });
      setStage("link", { state: "idle", summary: "waiting on a scored profile" });
      setRunning(false);
      return;
    }

    const [srcRes, tagRes] = await Promise.all([
      supabase
        .from("audio_sources")
        .select("id, name, source_type, analysis_status, analysis_error, profile_embedding, created_at")
        .eq("id", sourceId)
        .maybeSingle(),
      supabase
        .from("audio_source_tags")
        .select("weight, taxonomy_nodes(code, label)")
        .eq("audio_source_id", sourceId)
        .order("weight", { ascending: false }),
    ]);

    const src = srcRes.data as
      | {
          name: string;
          source_type: string;
          analysis_status: string;
          analysis_error: string | null;
          profile_embedding: unknown | null;
        }
      | null;
    const tags = (tagRes.data ?? []) as unknown as {
      weight: number;
      taxonomy_nodes: { code: string; label: string } | null;
    }[];

    setStage("source", {
      state: src ? (src.analysis_status === "failed" ? "error" : "ok") : "warn",
      summary: src
        ? `${src.name} · ${src.source_type} · ${src.analysis_status}${src.profile_embedding ? " · embedded" : ""}`
        : "audio source row not found",
      outputs: [
        ["Taxonomy tags", String(tags.length)],
        ...tags.slice(0, 8).map(
          (t) =>
            [t.taxonomy_nodes?.code ?? "unresolved", `weight ${Number(t.weight).toFixed(2)}`] as [
              string,
              string,
            ],
        ),
      ],
      notes: src?.analysis_error ? [src.analysis_error] : undefined,
    });

    // --- Stage: scoring ----------------------------------------------------
    setStage("score", { state: "running", summary: "reading ontology scores…" });
    const { data: ana } = await supabase
      .from("source_analyses")
      .select(
        "category, confidence, created_at, emotional_score, cognitive_score, social_score, communication_score, contextual_score, artistic_score",
      )
      .eq("audio_source_id", sourceId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (ana) {
      const conf = Number(ana.confidence ?? 0);
      setStage("score", {
        state: conf < 0.35 ? "warn" : "ok",
        summary: `${ana.category ?? "uncategorized"} · confidence ${conf.toFixed(2)}`,
        outputs: SCORE_FIELDS.map(
          ([k, label]) => [label, String(Math.round(Number(ana[k])))] as [string, string],
        ),
        notes:
          conf < 0.35
            ? ["Low confidence — thin taxonomy evidence. Request per-device signal detail for a stronger profile."]
            : undefined,
      });
    } else {
      setStage("score", {
        state: "error",
        summary: "no analysis row was produced",
        notes: ["The profile exists but analyze-audio did not return scores. Re-run the ingest for this activation."],
      });
    }

    // --- Stage: audience linkage ------------------------------------------
    setStage("link", { state: "running", summary: "counting linked identifiers…" });
    const { count } = await supabase
      .from("intuizi_identifiers")
      .select("id", { count: "exact", head: true })
      .eq("audio_source_id", sourceId);

    setStage("link", {
      state: (count ?? 0) > 1 ? "ok" : "warn",
      summary: `${count ?? 0} identifier(s) linked to this profile`,
      outputs: [
        ["Activation profile", `activation:${activation.activation_id}`],
        ["Devices / emails joined", String(Math.max(0, (count ?? 0) - 1))],
      ],
      notes:
        (count ?? 0) > 1
          ? undefined
          : ["No device roster is linked yet — ingest the maid/hem delivery for this activation id."],
    });

    setRunning(false);
  }, [activation, drainScoreQueue]);

  const run = useCallback(
    () => runFiles(activation?.files ?? [], false),
    [activation, runFiles],
  );
  const resume = useCallback(() => runFiles(partialFiles, true), [partialFiles, runFiles]);

  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-center gap-2">
        <Wand2 className="h-5 w-5 text-primary" />
        <h2 className="text-base font-semibold">Guided data stream wizard</h2>
        <Badge variant="outline" className="text-[11px]">admin only</Badge>
        <Button
          variant="outline"
          size="sm"
          className="ml-auto"
          onClick={discover}
          disabled={discovering || running}
        >
          {discovering ? (
            <Loader2 className="mr-1 h-4 w-4 animate-spin" />
          ) : (
            <Search className="mr-1 h-4 w-4" />
          )}
          {activations.length ? "Rescan bucket" : "Find activations"}
        </Button>
      </div>

      <p className="mt-2 text-xs text-muted-foreground">
        Pick an Intuizi activation id, then run the semantic stages in order: ingest and normalize the
        delivery, build the activation profile with taxonomy tags, score it through the ontology, and
        join the device roster.
      </p>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Select value={selected} onValueChange={setSelected} disabled={!activations.length || running}>
          <SelectTrigger className="w-full max-w-md">
            <SelectValue placeholder={activations.length ? "Select an activation id" : "Scan the bucket first"} />
          </SelectTrigger>
          <SelectContent>
            {activations.map((a) => (
              <SelectItem key={a.activation_id} value={a.activation_id}>
                {a.activation_id === "unassigned" ? "Unassigned files" : `Activation ${a.activation_id}`}
                {" · "}
                {a.files.length} file{a.files.length === 1 ? "" : "s"}
                {a.empty_files ? ` · ${a.empty_files} empty` : ""}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Button onClick={run} disabled={!activation || running || inferenceBlocked}>
          {running ? (
            <Loader2 className="mr-1 h-4 w-4 animate-spin" />
          ) : (
            <Play className="mr-1 h-4 w-4" />
          )}
          Run semantic processing
        </Button>

        {!running && !!Object.keys(results).length && (
          partialFiles.length ? (
            <>
              <Badge variant="outline" className="border-amber-500/50 text-amber-600 dark:text-amber-400">
                Partial · {partialFiles.length} file{partialFiles.length === 1 ? "" : "s"} left
              </Badge>
              <Button onClick={resume} disabled={inferenceBlocked} variant="secondary">
                <Play className="mr-1 h-4 w-4" />
                Resume ingestion
              </Button>
            </>
          ) : (
            <Badge variant="outline" className="border-emerald-500/50 text-emerald-600 dark:text-emerald-400">
              Complete
            </Badge>
          )
        )}

        {liveRun && (() => {
          const elapsed = Date.now() - liveRun.startedAt;
          const left = Math.max(0, liveRun.budgetMs - elapsed);
          const pct = Math.min(100, Math.round((elapsed / liveRun.budgetMs) * 100));
          return (
            <div
              className="w-full rounded-lg border border-primary/30 bg-primary/5 p-3 text-xs"
              role="status"
              aria-live="polite"
            >
              <div className="mb-2 flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="font-mono text-foreground/90">{fileName(liveRun.key)}</span>
                <span className="text-muted-foreground">
                  {fmtDuration(elapsed)} elapsed
                </span>
                <Badge variant="outline" className="text-[10px]">
                  {left > 0
                    ? `aborts in ~${fmtDuration(left)}`
                    : "past budget — checkpointing"}
                </Badge>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-primary transition-all"
                  style={{ width: `${pct}%` }}
                />
              </div>
            </div>
          );
        })()}

        {!running && !!deadlines.length && (
          <div className="w-full rounded-lg border border-border/60 bg-muted/20 p-3 text-xs">
            <p className="mb-2 font-medium text-foreground/90">Run budget &amp; deadline</p>
            <ul className="space-y-1.5">
              {deadlines.map((d) => (
                <li key={d.key} className="flex flex-wrap items-center gap-x-2 gap-y-1 text-muted-foreground">
                  <span className="font-mono text-foreground/90">{fileName(d.key)}</span>
                  <Badge variant="outline" className="text-[10px]">
                    budget {Math.round(d.budgetMs / 1000)}s
                    {d.defaultBudgetMs != null && d.defaultBudgetMs !== d.budgetMs
                      ? ` (default ${Math.round(d.defaultBudgetMs / 1000)}s)`
                      : ""}
                  </Badge>
                  {d.elapsedMs != null && <span>{fmtDuration(d.elapsedMs)} used</span>}
                  {d.timeRemainingMs != null && (
                    <span>· {fmtDuration(Math.max(0, d.timeRemainingMs))} left at finish</span>
                  )}
                  {d.deadlineExceeded ? (
                    <Badge variant="outline" className="border-amber-500/50 text-[10px] text-amber-600 dark:text-amber-400">
                      deadline exceeded{d.deadlineStep ? ` at ${d.deadlineStep}` : ""}
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="border-emerald-500/50 text-[10px] text-emerald-600 dark:text-emerald-400">
                      finished inside budget
                    </Badge>
                  )}
                  {d.phaseMs && (
                    <span className="font-mono text-[10px]">
                      {Object.entries(d.phaseMs)
                        .filter(([, v]) => v > 0)
                        .map(([k, v]) => `${k} ${Math.round(v / 100) / 10}s`)
                        .join(" · ")}
                    </span>
                  )}
                  {d.budgetReason && <span className="italic">{d.budgetReason}</span>}
                </li>
              ))}
            </ul>
          </div>
        )}

        {!running && !!phaseRuns.length && (
          <div className="w-full space-y-1">
            <PhaseCpuChart runs={phaseRuns} />
            <div className="flex justify-end">
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-2 text-[10px] text-muted-foreground"
                onClick={() => setPhaseRuns([])}
              >
                Clear phase history
              </Button>
            </div>
          </div>
        )}

        {/* Dead-letter visibility + one-click recovery for the background scorer. */}
        <div className="mt-4 w-full">
          <ScoreQueueHealthPanel activationId={selected || undefined} />
        </div>




        {!running && !!resumeEstimates.length && (

          <div className="w-full rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-xs">
            <p className="mb-2 font-medium text-amber-600 dark:text-amber-400">
              Resume forecast — each run stops at its tuned CPU-safe budget
            </p>
            <ul className="space-y-1">
              {resumeEstimates.map((e) => (
                <li key={e.key} className="flex flex-wrap items-center gap-x-2 gap-y-1 text-muted-foreground">
                  <span className="font-mono text-foreground/90">{fileName(e.key)}</span>
                  <span>
                    row group {e.cursor}
                    {e.total != null ? `/${e.total}` : ""}
                    {e.groupsRemaining != null ? ` · ${e.groupsRemaining} left` : ""}
                  </span>
                  {e.groupsNextRun != null && (
                    <Badge variant="outline" className="text-[10px]">
                      ~{e.groupsNextRun} row group{e.groupsNextRun === 1 ? "" : "s"} next run
                    </Badge>
                  )}
                  {e.etaMs != null && (
                    <Badge variant="outline" className="text-[10px]">
                      ~{fmtDuration(e.etaMs)} of processing left
                      {e.runsRemaining != null ? ` · ~${e.runsRemaining} run${e.runsRemaining === 1 ? "" : "s"}` : ""}
                    </Badge>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}





        {!!Object.keys(results).length && !running && (
          <Button variant="ghost" size="sm" onClick={() => setResults({})}>
            <RefreshCw className="mr-1 h-4 w-4" />
            Clear
          </Button>
        )}
      </div>

      <div className="mt-3">
        <InferenceConfigGuard
          readiness={readiness}
          loading={inferenceLoading}
          error={inferenceError}
          onRecheck={recheck}
        />
      </div>

      <ol className="mt-5 space-y-2">
        {STAGES.map(([key, label], i) => {
          const res = results[key];
          const state = res?.state ?? "idle";
          const hasDetails = !!res?.outputs?.length || !!res?.notes?.length;
          const open = expandedStages.includes(key);
          const tone =
            state === "ok"
              ? "border-primary/40 bg-primary/5"
              : state === "warn"
                ? "border-amber-500/40 bg-amber-500/5"
                : state === "error"
                  ? "border-destructive/40 bg-destructive/5"
                  : "border-border bg-muted/20";
          const pct = state === "ok" ? 100 : state === "running" ? 60 : state === "idle" ? 0 : 100;
          const barTone =
            state === "error"
              ? "[&>div]:bg-destructive"
              : state === "warn"
                ? "[&>div]:bg-amber-500"
                : "";
          return (
            <li key={key} className={`rounded-lg border px-3 py-2 ${tone}`}>
              <button
                type="button"
                onClick={() =>
                  hasDetails &&
                  setExpandedStages((prev) =>
                    prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key],
                  )}
                aria-expanded={open}
                disabled={!hasDetails}
                className="flex w-full items-center gap-2 text-left disabled:cursor-default"
              >
                <StageIcon state={state} />
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline gap-2">
                    <span className="truncate text-xs font-medium">
                      {i + 1}. {label}
                    </span>
                    <span className="ml-auto shrink-0 text-[11px] text-muted-foreground">
                      {res?.summary ?? "not started"}
                    </span>
                  </span>
                  <Progress
                    value={pct}
                    className={`mt-1.5 h-1 ${barTone} ${state === "running" ? "animate-pulse" : ""}`}
                  />
                </span>
                {hasDetails && (
                  <ChevronDown
                    className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`}
                    aria-hidden="true"
                  />
                )}
              </button>

              {open && !!res?.outputs?.length && (
                <div className="mt-2 grid gap-1 sm:grid-cols-2">
                  {res.outputs.map(([k, v]) => (
                    <div
                      key={`${k}-${v}`}
                      className="flex items-baseline justify-between gap-2 rounded border border-border/60 bg-background/60 px-2 py-1"
                    >
                      <span className="truncate text-[11px] text-muted-foreground" title={k}>
                        {k}
                      </span>
                      <span className="whitespace-nowrap text-[11px] font-medium">{v}</span>
                    </div>
                  ))}
                </div>
              )}

              {open && !!res?.notes?.length && (
                <ul className="mt-2 space-y-1">
                  {res.notes.map((n) => (
                    <li key={n} className="text-[11px] text-muted-foreground break-all">
                      • {n}
                    </li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ol>

    </Card>
  );
};

export default PostIngestionWizard;
