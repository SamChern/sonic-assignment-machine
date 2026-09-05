import type { PhaseRun } from "@/components/PhaseCpuChart";

export type { PhaseRun };

/* ------------------------------------------------------------------ types */

export interface ActivationFile {
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

export interface Activation {
  activation_id: string;
  files: ActivationFile[];
  empty_files: number;
  total_bytes: number;
  done_files: number;
}

/** Per-file resume forecast shown while an ingestion is partial. */
export interface ResumeEstimate {
  key: string;
  cursor: number;
  total: number | null;
  groupsRemaining: number | null;
  groupsNextRun: number | null;
  etaMs: number | null;
  runsRemaining: number | null;
}

/** What the last edge-function run reported about its own time budget. */
export interface DeadlineInfo {
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
export interface LiveRun {
  key: string;
  startedAt: number;
  budgetMs: number;
}

/**
 * What one control-plane run reports back. Since the transform moved to the EC2
 * DuckDB worker, a run reports the HAND-OFF (dispatch) — row counts arrive later
 * through the worker callback, which is why the wizard then watches the ledger.
 */
export interface IngestDispatchSummary {
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
export interface LedgerRow {
  object_key: string;
  status: string;
  processed_rows: number | null;
  total_rows: number | null;
  row_group_cursor: number | null;
  row_groups_total: number | null;
  error_message: string | null;
  heartbeat_at: string | null;
}

export type StageState = "idle" | "running" | "ok" | "warn" | "error";

export interface StageResult {
  state: StageState;
  summary: string;
  /** Rendered as a compact key/value output grid. */
  outputs?: [string, string][];
  notes?: string[];
}

export const STAGES = [
  ["discover", "Discover delivery"],
  ["ingest", "Ingest + normalize"],
  ["source", "Source + taxonomy tags"],
  ["score", "Semantic scoring"],
  ["link", "Audience linkage"],
] as const;

export type StageKey = typeof STAGES[number][0];

export const SCORE_FIELDS = [
  ["emotional_score", "Emotional"],
  ["cognitive_score", "Cognitive"],
  ["social_score", "Social"],
  ["communication_score", "Communication"],
  ["contextual_score", "Contextual"],
  ["artistic_score", "Artistic"],
] as const;
