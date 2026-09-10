import { supabase } from "@/integrations/supabase/client";
import {
  PHASE_HISTORY_MAX,
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
  StageKey,
  StageResult,
} from "@/lib/wizard/types";
import { SCORE_FIELDS } from "@/lib/wizard/types";

export interface RunPipelineDeps {
  activation: Activation;
  setStage: (key: StageKey, value: StageResult) => void;
  setRunning: (v: boolean) => void;
  setLiveRun: (v: LiveRun | null) => void;
  setDeadlines: (v: DeadlineInfo[]) => void;
  setPhaseRuns: (fn: (prev: PhaseRun[]) => PhaseRun[]) => void;
  setPartialFiles: (v: ActivationFile[]) => void;
  setResumeEstimates: (v: ResumeEstimate[]) => void;
  lastBudgetMsRef: { current: number };
  drainScoreQueue: (activationId: string) => Promise<void>;
}

/**
 * Steps 1-4 — run the semantic pipeline for the given files of the activation.
 * Extracted verbatim from the wizard hook so it stays under the file size
 * budget; behaviour and network calls are unchanged.
 */
export async function runIngestPipeline(
  files: ActivationFile[],
  resuming: boolean,
  deps: RunPipelineDeps,
): Promise<void> {
  const {
    activation,
    setStage,
    setRunning,
    setLiveRun,
    setDeadlines,
    setPhaseRuns,
    setPartialFiles,
    setResumeEstimates,
    lastBudgetMsRef,
    drainScoreQueue,
  } = deps;

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
      setLiveRun({ key: f.object_key, startedAt: t0, budgetMs: lastBudgetMsRef.current });
      const { data, error, retries, shrink } = await invokeIngestWithRetry(
        { object_key: f.object_key, report_type: f.report_type ?? undefined },
        (attempt, nextShrink) => {
          ingestErrors.push(
            `${fileName(f.object_key)}: the dispatch run hit a compute limit — retry ${attempt} re-dispatches at ${Math.round(nextShrink * 100)}% row slice.`,
          );
          setLiveRun({ key: f.object_key, startedAt: Date.now(), budgetMs: lastBudgetMsRef.current });
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
          budgetMs: lastBudgetMsRef.current,
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
      lastBudgetMsRef.current = budgetMs;
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

    // --- Stage: source + tags ---------------------------------------------
    // The activation profile is BUILT here, not merely read: normalization now
    // happens on the EC2 worker, which emits per-identifier rows only, so the
    // audience-level profile has to be assembled from what already landed in the
    // database (queue tags + scored identifiers). This is idempotent, costs no AI
    // credits, and repairs an activation whose profile is missing or stale.
    //
    // It deliberately runs BEFORE the scoring drain: the taxonomy side of the
    // profile only needs the queued rows, so waiting for a 100k-deep scoring
    // queue (which is rate-limited by the AI gateway) used to leave this step
    // stuck at "not started" for many minutes.
    setStage("source", { state: "running", summary: "building the activation profile…" });


    let identifiersSeen = 0;
    let buildError: string | null = null;
    try {
      const { data: built, error: buildErr } = await supabase.rpc("build_activation_profile", {
        p_activation: activation.activation_id,
        p_sample: 20000,
        p_top_tags: 40,
      });
      if (buildErr) throw new Error(buildErr.message);
      const row = (Array.isArray(built) ? built[0] : built) as
        | { identifiers_seen?: number | null }
        | null;
      identifiersSeen = Number(row?.identifiers_seen ?? 0) || 0;
    } catch (e) {
      buildError = e instanceof Error ? e.message : String(e);
    }

    const { data: profileRow } = await supabase
      .from("intuizi_identifiers")
      .select("audio_source_id")
      .eq("primary_identifier", `activation:${activation.activation_id}`)
      .maybeSingle();
    const sourceId = profileRow?.audio_source_id ?? null;

    if (!sourceId) {
      setStage("source", {
        state: "warn",
        summary: "no activation profile could be built",
        notes: [
          buildError
            ? `Profile builder: ${buildError}`
            : "No normalized taxonomy rows are queued for this activation id yet, so there is nothing to aggregate. Re-run the ingest, or ingest the summary/signals report for this activation.",
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

    // --- CLAP grounding ----------------------------------------------------
    // Every audio row in this activation (and the audience profile itself) gets
    // a vector in CLAP's space on the EC2 box, so profile <-> track kNN is
    // comparable. Enrichment only: an unreachable box degrades to a note.
    setStage("source", {
      state: "running",
      summary: "grounding this activation's audio on the CLAP box…",
    });

    let groundNote: string | null = null;
    let groundedNow = 0;
    type Scores = Record<string, number>;
    let tuning: {
      tuned?: boolean;
      neighbours?: number;
      avg_similarity?: number;
      confidence_before?: number;
      confidence_after?: number;
      scores_before?: Scores | null;
      scores_after?: Scores | null;
    } | null = null;
    let profileGrounded = Boolean(src?.profile_embedding);
    try {
      const { data: ground, error: groundErr } = await supabase.functions.invoke(
        "clap-ground-audio",
        { body: { activation_id: activation.activation_id, limit: 25 } },
      );
      if (groundErr) throw new Error(groundErr.message);
      const g = (ground ?? {}) as {
        success?: boolean;
        error?: string;
        grounded?: number;
        failed?: number;
        profile_grounded?: boolean;
        profile_tuning?: {
          tuned?: boolean;
          neighbours?: number;
          avg_similarity?: number;
          confidence_before?: number;
          confidence_after?: number;
          scores_before?: Scores | null;
          scores_after?: Scores | null;
        } | null;
        notes?: string[];
      };
      if (g.success === false) throw new Error(g.error ?? "grounding failed");
      groundedNow = Number(g.grounded ?? 0) || 0;
      profileGrounded = profileGrounded || Boolean(g.profile_grounded);
      tuning = g.profile_tuning ?? null;
      if (g.notes?.length) groundNote = `Grounding: ${g.notes[0]}`;
      else if (Number(g.failed ?? 0) > 0) groundNote = `Grounding: ${g.failed} row(s) could not be embedded.`;
    } catch (e) {
      groundNote = `Audio grounding skipped — ${e instanceof Error ? e.message : String(e)}`;
    }

    // Six-axis comparison: what the taxonomy text said vs what the CLAP audio
    // neighbours pulled it to. `scores_before/after` only exist when tuning ran,
    // so fall back to the stored analysis row for a text-only readout.
    const CATS = [
      ["emotional", "Emotional"],
      ["cognitive", "Cognitive"],
      ["social", "Social"],
      ["communication", "Communication"],
      ["contextual", "Contextual"],
      ["artistic", "Artistic"],
    ] as const;

    const { data: anaRow } = await supabase
      .from("source_analyses")
      .select(
        "emotional_score, cognitive_score, social_score, communication_score, contextual_score, artistic_score",
      )
      .eq("audio_source_id", sourceId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const before = tuning?.scores_before ?? null;
    const after = tuning?.scores_after ?? null;
    const scoreRows: [string, string][] = CATS.map(([key, label]) => {
      const textScore = Number(
        before?.[key] ?? (anaRow as Record<string, unknown> | null)?.[`${key}_score`] ?? 0,
      );
      if (!after) return [`${label} (text)`, `${Math.round(textScore)}`];
      const audioScore = Math.round(Number(after[key] ?? textScore));
      const delta = audioScore - Math.round(textScore);
      return [
        `${label} · text → audio`,
        `${Math.round(textScore)} → ${audioScore}${delta === 0 ? "" : ` (${delta > 0 ? "+" : ""}${delta})`}`,
      ];
    });

    setStage("source", {
      state: !src || tags.length === 0 ? "warn" : src.analysis_status === "failed" ? "error" : "ok",
      summary: src
        ? `${src.name} · ${tags.length} taxonomy tag(s) · ${src.analysis_status}${profileGrounded ? " · grounded vector" : ""}`
        : "audio source row not found",
      outputs: [
        ["Queued rows aggregated", identifiersSeen.toLocaleString()],
        ["Taxonomy tags", String(tags.length)],
        ["Profile vector", profileGrounded ? "grounded (CLAP)" : "not grounded yet"],
        ["Audio rows grounded now", String(groundedNow)],
        [
          "Scores tuned by audio",
          tuning?.tuned
            ? `yes · ${tuning.neighbours ?? 0} close track(s), confidence ${(
                Number(tuning.confidence_before ?? 0) * 100
              ).toFixed(0)}% → ${(Number(tuning.confidence_after ?? 0) * 100).toFixed(0)}%`
            : "no · using tag-based scores",
        ],
        ...scoreRows,
        ...tags.slice(0, 8).map(
          (t) =>
            [t.taxonomy_nodes?.code ?? "unresolved", `weight ${Number(t.weight).toFixed(2)}`] as [
              string,
              string,
            ],
        ),
      ],
      notes: [
        ...(src?.analysis_error ? [src.analysis_error] : []),
        ...(tags.length === 0
          ? [
              "No queued tag code matched a taxonomy node. Run the Intuizi taxonomy crosswalk so these codes resolve, then re-run this step.",
            ]
          : []),
        ...(groundNote ? [groundNote] : []),
        ...(buildError ? [`Profile builder warning: ${buildError}`] : []),
      ].slice(0, 3),
    });

    // --- Background scoring -----------------------------------------------
    // Ingest only enqueues scoring work, so kick `intuizi-score-worker` and poll
    // its progress here. The worker self-chains, so this never blocks the run
    // budget — and the profile above is already on screen while it drains.
    await drainScoreQueue(activation.activation_id);

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
        notes: [
          "The profile exists but no per-identifier scores were available to aggregate yet. Let the scoring queue drain for this activation, then re-run this step.",
        ],
      });
    }

    // --- Stage: audience linkage ------------------------------------------
    setStage("link", { state: "running", summary: "counting activation identifiers…" });

    setStage("link", {
      state: identifiersSeen > 0 ? "ok" : "warn",
      summary: `${identifiersSeen.toLocaleString()} identifier row(s) in this activation`,
      outputs: [
        ["Activation profile", `activation:${activation.activation_id}`],
        ["Identifier rows", identifiersSeen.toLocaleString()],
      ],
      notes:
        identifiersSeen > 0
          ? undefined
          : ["No device roster is linked yet — ingest the maid/hem delivery for this activation id."],
    });

    setRunning(false);
  
}
