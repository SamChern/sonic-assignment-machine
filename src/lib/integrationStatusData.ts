/**
 * Data-fetching for the Intuizi Console stage view.
 *
 * Pulled out of the page component so the page stays about rendering; this
 * module owns the Supabase queries and the derivation of Stage rows.
 */
import { supabase } from "@/integrations/supabase/client";
import { type DetailRow, type Stage, staleness } from "@/pages/integrationStatus/stageModel";

export interface IngestState {
  paused: boolean | null;
  pause_reason: string | null;
  parked_until: string | null;
  last_run_at: string | null;
  last_error: string | null;
}

export interface IntegrationStatusData {
  stages: Stage[];
  ingestState: IngestState | null;
}

export const fetchIntegrationStatus = async (): Promise<IntegrationStatusData> => {
  const [batches, jobs, nodes, analyses, calibration, callLog, cache, ingestFiles, ingestState] =
    await Promise.all([
      supabase
        .from("ctv_ingest_batches")
        .select("id, feed_name, status, total_rows, success_rows, failed_rows, created_at, updated_at, file_uri")
        .order("created_at", { ascending: false })
        .limit(25),
      supabase
        .from("analysis_jobs")
        .select("id, status, attempts, last_error, created_at, started_at, finished_at")
        .order("created_at", { ascending: false })
        .limit(200),
      supabase
        .from("taxonomy_nodes")
        .select("id, embedding, updated_at")
        .order("updated_at", { ascending: false })
        .limit(500),
      supabase
        .from("source_analyses")
        .select("id, category, confidence, created_at")
        .order("created_at", { ascending: false })
        .limit(200),
      supabase
        .from("category_calibration")
        .select("id, category, n, bias, updated_at")
        .order("updated_at", { ascending: false })
        .limit(100),
      supabase
        .from("librosa_call_log")
        .select("id, outcome, cache_hit, duration_ms, created_at")
        .order("created_at", { ascending: false })
        .limit(200),
      supabase
        .from("librosa_cache")
        .select("cache_key, status, hit_count, ready_at, created_at")
        .order("created_at", { ascending: false })
        .limit(200),
      supabase
        .from("intuizi_ingest_files")
        .select(
          "id, object_key, report_type, status, total_rows, processed_rows, failed_rows, partition_date, error_message, discovered_at, started_at, finished_at",
        )
        .order("discovered_at", { ascending: false })
        .limit(25),
      supabase
        .from("intuizi_ingest_state")
        .select("paused, pause_reason, parked_until, last_run_at, last_error, last_run_summary")
        .eq("id", "singleton")
        .maybeSingle(),
    ]);

  const batchRows = batches.data ?? [];
  const jobRows = jobs.data ?? [];
  const nodeRows = nodes.data ?? [];
  const analysisRows = analyses.data ?? [];
  const calibrationRows = calibration.data ?? [];
  const logRows = callLog.data ?? [];
  const cacheRows = cache.data ?? [];
  const fileRows = ingestFiles.data ?? [];
  const ingestStateRow = ingestState.data ?? null;

  const lastFile = fileRows[0] ?? null;
  const doneFiles = fileRows.filter((f) => f.status === "done").length;
  const failedFiles = fileRows.filter((f) => f.status === "failed").length;
  const objectRowsSeen = fileRows.reduce((a, f) => a + (f.total_rows ?? 0), 0);

  const lastBatch = batchRows[0] ?? null;
  const failedBatches = batchRows.filter((b) => b.status === "failed").length;
  const inboundRows = batchRows.reduce((a, b) => a + (b.total_rows ?? 0), 0);
  const failedRows = batchRows.reduce((a, b) => a + (b.failed_rows ?? 0), 0);
  const successRows = batchRows.reduce((a, b) => a + (b.success_rows ?? 0), 0);

  const pendingJobs = jobRows.filter((j) => j.status === "pending").length;
  const runningJobs = jobRows.filter((j) => j.status === "running").length;
  const failedJobs = jobRows.filter((j) => j.status === "failed").length;
  const doneJobs = jobRows.filter((j) => j.status === "done" || j.status === "complete").length;
  const lastJob = jobRows[0] ?? null;
  const lastFinishedJob = jobRows.find((j) => j.finished_at) ?? null;

  const embedded = nodeRows.filter((n) => n.embedding !== null).length;
  const lastNodeUpdate = nodeRows[0]?.updated_at ?? null;

  const lastAnalysis = analysisRows[0] ?? null;
  const categorized = analysisRows.filter((a) => a.category).length;
  const avgConfidence = analysisRows.length
    ? analysisRows.reduce((a, r) => a + Number(r.confidence ?? 0), 0) / analysisRows.length
    : 0;

  const lastCalibration = calibrationRows[0] ?? null;
  const calibrationObs = calibrationRows.reduce((a, r) => a + (r.n ?? 0), 0);

  const logErrors = logRows.filter((l) => l.outcome !== "success" && l.outcome !== "ok").length;
  const cacheHits = logRows.filter((l) => l.cache_hit).length;
  const readyCache = cacheRows.filter((c) => c.status === "ready").length;
  const lastLog = logRows[0] ?? null;

  const batchDetails: DetailRow[] = batchRows.slice(0, 10).map((b) => ({
    id: b.id,
    title: b.feed_name ?? "unnamed feed",
    timestamp: b.created_at,
    status: b.status,
    meta: `${b.total_rows ?? 0} rows · ${b.success_rows ?? 0} ok · ${b.failed_rows ?? 0} failed`,
  }));

  const fileDetails: DetailRow[] = fileRows.slice(0, 12).map((f) => ({
    id: f.id,
    title: f.object_key,
    timestamp: f.finished_at ?? f.started_at ?? f.discovered_at,
    status: f.status,
    meta: `${f.report_type}${f.partition_date ? ` · ${f.partition_date}` : ""} · ` +
      `${f.processed_rows ?? 0}/${f.total_rows ?? 0} scored · ${f.failed_rows ?? 0} failed`,
    error: f.error_message ?? null,
  }));

  const normalizerDetails: DetailRow[] = batchRows.slice(0, 10).map((b) => ({
    id: b.id,
    title: `${b.feed_name ?? "batch"} — ${b.success_rows ?? 0}/${b.total_rows ?? 0} resolved`,
    timestamp: b.updated_at ?? b.created_at,
    status: (b.failed_rows ?? 0) > 0 ? "partial" : b.status,
    meta: `${b.failed_rows ?? 0} rejected rows`,
    error: (b as { error_message?: string | null }).error_message ?? null,
  }));

  const jobDetails: DetailRow[] = jobRows.slice(0, 15).map((j) => ({
    id: j.id,
    title: j.id,
    timestamp: j.finished_at ?? j.started_at ?? j.created_at,
    status: j.status,
    meta: `attempts ${j.attempts ?? 0}`,
    error: j.last_error ?? null,
  }));

  const librosaDetails: DetailRow[] = logRows.slice(0, 15).map((l) => ({
    id: l.id,
    title: l.cache_hit ? "cache hit" : "upstream call",
    timestamp: l.created_at,
    status: l.outcome,
    meta: l.duration_ms != null ? `${l.duration_ms} ms` : undefined,
    error: (l as { error_message?: string | null }).error_message ?? null,
  }));

  const taxonomyDetails: DetailRow[] = nodeRows.slice(0, 15).map((n) => ({
    id: n.id,
    title: n.id,
    timestamp: n.updated_at,
    status: n.embedding ? "embedded" : "missing embedding",
  }));

  const analyzeDetails: DetailRow[] = analysisRows.slice(0, 15).map((a) => ({
    id: a.id,
    title: a.id,
    timestamp: a.created_at,
    status: a.category ?? "uncategorized",
    meta: `confidence ${Number(a.confidence ?? 0).toFixed(2)}`,
  }));

  const calibrationDetails: DetailRow[] = calibrationRows.slice(0, 15).map((c) => ({
    id: c.id,
    title: c.category,
    timestamp: c.updated_at,
    status: `n=${c.n ?? 0}`,
    meta: `bias ${Number(c.bias ?? 0).toFixed(3)}`,
  }));

  const stages: Stage[] = [
    {
      key: "intuizi",
      title: "Intuizi console feed",
      subtitle: "Audience export scheduled from the Intuizi console",
      health: lastBatch ? staleness(lastBatch.created_at, 48) : "idle",
      lastRunAt: lastBatch?.created_at ?? null,
      metrics: [
        { label: "Latest feed", value: lastBatch?.feed_name ?? "—" },
        { label: "Batches tracked", value: String(batchRows.length) },
        { label: "Rows delivered", value: String(inboundRows) },
      ],
      note: lastBatch
        ? undefined
        : "No delivery recorded yet — the first console export will appear here.",
      detailsLabel: "Latest batches",
      details: batchDetails,
    },
    {
      key: "s3",
      title: "S3 inbound drop",
      subtitle: "Objects landing in the Intuizi inbound bucket and picked up by the ingest worker",
      health: ingestStateRow?.paused
        ? "error"
        : !lastFile
          ? "idle"
          : failedFiles > doneFiles
            ? "error"
            : failedFiles > 0
              ? "warn"
              : staleness(ingestStateRow?.last_run_at ?? lastFile.discovered_at, 36),
      lastRunAt: ingestStateRow?.last_run_at ?? lastFile?.discovered_at ?? null,
      metrics: [
        { label: "Latest object", value: lastFile?.object_key ?? "none seen yet" },
        { label: "Objects processed", value: `${doneFiles}/${fileRows.length}` },
        { label: "Rows read", value: String(objectRowsSeen) },
        { label: "Failed objects", value: String(failedFiles) },
      ],
      note: ingestStateRow?.paused
        ? `Ingest is paused: ${ingestStateRow.pause_reason ?? "unknown reason"} — resume it once the cause is cleared.`
        : ingestStateRow?.parked_until && new Date(ingestStateRow.parked_until) > new Date()
          ? "Parked after repeated rate limits — the next scheduled run retries automatically."
          : !lastFile
            ? "No S3 objects seen yet. Once Intuizi drops files under ctv/, apps/, visitation/, demographics/ or origin/, the worker picks them up."
            : ingestStateRow?.last_error ?? undefined,
      detailsLabel: "Recent objects",
      details: fileDetails,
    },
    {
      key: "normalizer",
      title: "Normalizer & identity resolution",
      subtitle: "Row parsing, taxonomy tagging and audio source upsert",
      health: !lastBatch
        ? "idle"
        : failedRows > 0
          ? failedRows > successRows
            ? "error"
            : "warn"
          : "ok",
      lastRunAt: lastBatch?.updated_at ?? lastBatch?.created_at ?? null,
      metrics: [
        { label: "Rows resolved", value: String(successRows) },
        { label: "Rows rejected", value: String(failedRows) },
        {
          label: "Resolve rate",
          value: inboundRows ? `${Math.round((successRows / inboundRows) * 100)}%` : "—",
        },
      ],
      detailsLabel: "Per-batch resolution",
      details: normalizerDetails,
    },
    {
      key: "analysis_jobs",
      title: "analysis_jobs queue",
      subtitle: "Background librosa feature extraction on EC2 workers",
      health: !jobRows.length
        ? "idle"
        : failedJobs > 0 && failedJobs >= doneJobs
          ? "error"
          : failedJobs > 0 || pendingJobs > 25
            ? "warn"
            : "ok",
      lastRunAt: lastFinishedJob?.finished_at ?? lastJob?.created_at ?? null,
      metrics: [
        { label: "Pending", value: String(pendingJobs) },
        { label: "Running", value: String(runningJobs) },
        { label: "Done", value: String(doneJobs) },
        { label: "Failed", value: String(failedJobs) },
      ],
      note: lastJob?.last_error ? `Last error: ${lastJob.last_error}` : undefined,
      detailsLabel: "Latest jobs",
      details: jobDetails,
    },
    {
      key: "librosa",
      title: "Feature cache & worker health",
      subtitle: "librosa_cache reuse and call outcomes",
      health: !logRows.length
        ? "idle"
        : logErrors > logRows.length / 4
          ? "error"
          : logErrors > 0
            ? "warn"
            : "ok",
      lastRunAt: lastLog?.created_at ?? null,
      metrics: [
        { label: "Cached ready", value: String(readyCache) },
        {
          label: "Cache hit rate",
          value: logRows.length ? `${Math.round((cacheHits / logRows.length) * 100)}%` : "—",
        },
        { label: "Errors (last 200)", value: String(logErrors) },
      ],
      detailsLabel: "Recent calls",
      details: librosaDetails,
    },
    {
      key: "taxonomy",
      title: "taxonomy_nodes & kNN",
      subtitle: "Embedded taxonomy anchors backing nearest-neighbour context",
      health: !nodeRows.length ? "idle" : embedded === 0 ? "error" : embedded < nodeRows.length ? "warn" : "ok",
      lastRunAt: lastNodeUpdate,
      metrics: [
        { label: "Nodes", value: String(nodeRows.length) },
        { label: "Embedded", value: String(embedded) },
        {
          label: "Coverage",
          value: nodeRows.length ? `${Math.round((embedded / nodeRows.length) * 100)}%` : "—",
        },
      ],
      detailsLabel: "Recently updated nodes",
      details: taxonomyDetails,
    },
    {
      key: "analyze",
      title: "analyze-audio scoring",
      subtitle: "Six-category semantic scoring and ontology label assignment",
      health: !analysisRows.length ? "idle" : categorized < analysisRows.length ? "warn" : "ok",
      lastRunAt: lastAnalysis?.created_at ?? null,
      metrics: [
        { label: "Recent analyses", value: String(analysisRows.length) },
        { label: "Categorized", value: String(categorized) },
        { label: "Avg confidence", value: analysisRows.length ? avgConfidence.toFixed(2) : "—" },
      ],
      detailsLabel: "Latest analyses",
      details: analyzeDetails,
    },
    {
      key: "calibration",
      title: "category_calibration",
      subtitle: "Bayesian anchor updates from feedback and new observations",
      health: lastCalibration ? staleness(lastCalibration.updated_at, 24 * 7) : "idle",
      lastRunAt: lastCalibration?.updated_at ?? null,
      metrics: [
        { label: "Calibrated pairs", value: String(calibrationRows.length) },
        { label: "Observations", value: String(calibrationObs) },
      ],
      note: lastCalibration
        ? undefined
        : "Run recalibration from the CTV console to seed calibration anchors.",
      detailsLabel: "Calibration anchors",
      details: calibrationDetails,
    },
    {
      key: "outbound",
      title: "Outbound segments",
      subtitle: "Scored cohorts pushed back to the Intuizi console",
      health: categorized > 0 ? "warn" : "idle",
      lastRunAt: null,
      metrics: [
        { label: "Segment-ready analyses", value: String(categorized) },
        { label: "Monthly target", value: "10,000 users" },
      ],
      note: "Activation export is not wired yet — cohorts are staged locally until the outbound job is enabled.",
      detailsLabel: "Export runs",
      details: [],
    },
  ];

  return { stages, ingestState: ingestStateRow };
};
