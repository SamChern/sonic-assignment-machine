import { useEffect, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/hooks/use-toast";
import IngestDebugPanel from "@/components/IngestDebugPanel";
import IngestByKeyPanel from "@/components/IngestByKeyPanel";
import EnrichmentReadinessPanel from "@/components/EnrichmentReadinessPanel";


import {
  ArrowLeft,
  RefreshCw,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  CircleDashed,
  Activity,
  Radio,
  ChevronDown,
  PlayCircle,
} from "lucide-react";

type Health = "ok" | "warn" | "error" | "idle";

interface DetailRow {
  id: string;
  title: string;
  timestamp: string | null;
  status?: string;
  meta?: string;
  error?: string | null;
}

interface Stage {
  key: string;
  title: string;
  subtitle: string;
  health: Health;
  lastRunAt: string | null;
  metrics: { label: string; value: string }[];
  note?: string;
  detailsLabel: string;
  details: DetailRow[];
}


const HEALTH_META: Record<
  Health,
  { label: string; icon: typeof CheckCircle2; className: string }
> = {
  ok: { label: "Healthy", icon: CheckCircle2, className: "bg-primary/15 text-primary border-primary/30" },
  warn: { label: "Degraded", icon: AlertTriangle, className: "bg-amber-500/15 text-amber-500 border-amber-500/30" },
  error: { label: "Failing", icon: XCircle, className: "bg-destructive/15 text-destructive border-destructive/30" },
  idle: { label: "No data yet", icon: CircleDashed, className: "bg-muted text-muted-foreground border-border" },
};

const relative = (iso: string | null) => {
  if (!iso) return "never";
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.round(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 48) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
};

const staleness = (iso: string | null, warnHours: number): Health => {
  if (!iso) return "idle";
  const hrs = (Date.now() - new Date(iso).getTime()) / 3600000;
  return hrs > warnHours ? "warn" : "ok";
};

const IntegrationStatus = () => {
  const { user, isAdmin, loading } = useAuth();
  const navigate = useNavigate();
  const [stages, setStages] = useState<Stage[]>([]);
  const [refreshing, setRefreshing] = useState(true);
  const [fetchedAt, setFetchedAt] = useState<Date | null>(null);
  const [expandedStages, setExpandedStages] = useState<Record<string, boolean>>({});
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [ingestState, setIngestState] = useState<{
    paused: boolean | null;
    pause_reason: string | null;
    parked_until: string | null;
    last_run_at: string | null;
    last_error: string | null;
  } | null>(null);
  const [running, setRunning] = useState(false);

  const stagePrefsKey = user ? `sonicsim.pipeline.expandedStages.${user.id}` : null;

  // Restore this user's saved collapse/expand choices.
  useEffect(() => {
    if (!stagePrefsKey) return;
    try {
      const raw = localStorage.getItem(stagePrefsKey);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object") setExpandedStages(parsed as Record<string, boolean>);
      }
    } catch {
      /* ignore malformed prefs */
    }
  }, [stagePrefsKey]);

  const persistStages = useCallback(
    (next: Record<string, boolean>) => {
      if (!stagePrefsKey) return;
      try {
        localStorage.setItem(stagePrefsKey, JSON.stringify(next));
      } catch {
        /* storage unavailable */
      }
    },
    [stagePrefsKey],
  );

  const toggle = (key: string) =>
    setExpanded((prev) => ({ ...prev, [key]: !prev[key] }));

  const toggleStage = (key: string) =>
    setExpandedStages((prev) => {
      const next = { ...prev, [key]: !prev[key] };
      persistStages(next);
      return next;
    });

  const setAllStages = (open: boolean) => {
    const next: Record<string, boolean> = {};
    stages.forEach((s) => {
      next[s.key] = open;
    });
    setExpandedStages(next);
    persistStages(next);
  };


  useEffect(() => {
    if (!loading) {
      if (!user) navigate("/auth");
      else if (!isAdmin) navigate("/");
    }
  }, [loading, user, isAdmin, navigate]);

  const load = useCallback(async () => {
    setRefreshing(true);
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
    setIngestState(ingestStateRow);

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

    const next: Stage[] = [
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


    setStages(next);
    setFetchedAt(new Date());
    setRefreshing(false);
  }, []);

  useEffect(() => {
    if (isAdmin) load();
  }, [isAdmin, load]);

  const invokeIngest = useCallback(
    async (action: "run_now" | "resume") => {
      setRunning(true);
      try {
        const { data, error } = await supabase.functions.invoke("intuizi-ingest", {
          body: { action },
        });
        if (error) {
          const details =
            "context" in error && error.context
              ? await (error.context as Response).text().catch(() => error.message)
              : error.message;
          toast({ title: "Ingest run failed", description: details, variant: "destructive" });
        } else if (data?.error) {
          toast({ title: "Ingest blocked", description: String(data.error), variant: "destructive" });
        } else if (action === "resume") {
          toast({ title: "Ingest resumed", description: "The next run will process a full batch." });
        } else {
          toast({
            title: data?.idle ? "Nothing new to ingest" : "Ingest run complete",
            description: data?.idle
              ? "No unprocessed objects found in the inbound bucket."
              : `${data?.files_processed ?? 0} object(s), ${data?.identifiers_scored ?? 0} identifier(s) scored.`,
          });
        }
      } finally {
        setRunning(false);
        load();
      }
    },
    [load],
  );

  if (loading || !isAdmin) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card/40 backdrop-blur sticky top-0 z-10">
        <div className="container mx-auto px-4 sm:px-6 py-3 sm:py-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="sm" onClick={() => navigate("/admin")}>
              <ArrowLeft className="h-4 w-4 mr-1" /> Back
            </Button>
            <div className="flex items-center gap-2">
              <Activity className="h-5 w-5 text-primary" />
              <h1 className="text-lg sm:text-xl font-semibold truncate">Intuizi Console</h1>
            </div>
          </div>
          <div className="flex items-center gap-2 sm:gap-3 overflow-x-auto no-scrollbar -mx-1 px-1">
            {ingestState?.paused ? (
              <Button variant="default" size="sm" onClick={() => invokeIngest("resume")} disabled={running}>
                {running ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <PlayCircle className="h-4 w-4 mr-2" />}
                Resume ingest
              </Button>
            ) : (
              <Button variant="secondary" size="sm" onClick={() => invokeIngest("run_now")} disabled={running}>
                {running ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <PlayCircle className="h-4 w-4 mr-2" />}
                Run ingest
              </Button>
            )}
            <span className="text-xs text-muted-foreground hidden sm:inline">
              {fetchedAt ? `Updated ${fetchedAt.toLocaleTimeString()}` : "Loading…"}
            </span>
            <Button variant="outline" size="sm" onClick={load} disabled={refreshing}>
              {refreshing ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4 mr-2" />
              )}
              Refresh
            </Button>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 sm:px-6 py-6 sm:py-8 max-w-4xl space-y-4">
        <p className="text-sm text-muted-foreground">
          End-to-end pipeline health from the Intuizi console through to outbound
          segment activation. Stages are collapsed by default; expand any step
          to inspect its counters and latest records.
        </p>

        <ol className="space-y-4">
          {stages.map((stage, index) => {
            const meta = HEALTH_META[stage.health];
            const Icon = meta.icon;
            const stageOpen = !!expandedStages[stage.key];
            return (
              <li key={stage.key} className="relative pl-8">
                {index < stages.length - 1 && (
                  <span
                    aria-hidden
                    className="absolute left-[11px] top-8 bottom-[-1rem] w-px bg-border"
                  />
                )}
                <span className="absolute left-0 top-5 flex h-6 w-6 items-center justify-center rounded-full border border-border bg-card text-xs font-medium text-muted-foreground">
                  {index + 1}
                </span>
                <Card className="p-5 space-y-3">
                  <div className="flex items-start justify-between gap-4 flex-wrap">
                    <div>
                      <h2 className="font-semibold">{stage.title}</h2>
                      <p className="text-sm text-muted-foreground">{stage.subtitle}</p>
                    </div>
                    <div className="flex flex-col items-end gap-2">
                      <div className="flex flex-wrap items-center justify-end gap-2">
                        <Badge variant="outline" className={`gap-1 ${meta.className}`}>
                          <Icon className="h-3 w-3" /> {meta.label}
                        </Badge>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-8 gap-1 text-xs"
                          onClick={() => toggleStage(stage.key)}
                          aria-expanded={stageOpen}
                          aria-label={`${stageOpen ? "Collapse" : "Expand"} ${stage.title}`}
                        >
                          {stageOpen ? "Collapse" : "Expand"}
                          <ChevronDown className={`h-4 w-4 transition-transform ${stageOpen ? "rotate-180" : ""}`} />
                        </Button>
                      </div>
                      <span
                        className="text-xs text-muted-foreground"
                        title={stage.lastRunAt ? new Date(stage.lastRunAt).toLocaleString() : undefined}
                      >
                        Last run {relative(stage.lastRunAt)}
                      </span>
                    </div>
                  </div>

                  {stageOpen && (
                    <>
                      <div className="flex flex-wrap gap-x-6 gap-y-2">
                        {stage.metrics.map((m) => (
                          <div key={m.label}>
                            <p className="text-xs text-muted-foreground">{m.label}</p>
                            <p className="text-sm font-medium break-all">{m.value}</p>
                          </div>
                        ))}
                      </div>

                      {stage.note && (
                        <p className="text-xs text-muted-foreground border-t border-border pt-2">
                          {stage.note}
                        </p>
                      )}

                      <div className="border-t border-border pt-2">
                        <button
                          type="button"
                          onClick={() => toggle(stage.key)}
                          aria-expanded={!!expanded[stage.key]}
                          className="flex w-full items-center justify-between gap-2 text-sm font-medium text-primary hover:underline"
                        >
                          <span>
                            {stage.detailsLabel}
                            {stage.details.length ? ` (${stage.details.length})` : ""}
                          </span>
                          <ChevronDown
                            className={`h-4 w-4 transition-transform ${expanded[stage.key] ? "rotate-180" : ""}`}
                          />
                        </button>

                        {expanded[stage.key] && (
                          <div className="mt-3 space-y-2">
                            {stage.details.length === 0 ? (
                              <p className="text-xs text-muted-foreground">
                                No runs recorded for this stage yet.
                              </p>
                            ) : (
                              stage.details.map((row) => (
                                <div
                                  key={row.id}
                                  className="rounded-md border border-border bg-muted/30 p-3 space-y-1"
                                >
                                  <div className="flex items-start justify-between gap-3 flex-wrap">
                                    <p className="text-xs font-mono break-all">{row.title}</p>
                                    {row.status && (
                                      <Badge variant="outline" className="text-xs shrink-0">
                                        {row.status}
                                      </Badge>
                                    )}
                                  </div>
                                  <div className="flex flex-wrap gap-x-4 text-xs text-muted-foreground">
                                    <span
                                      title={
                                        row.timestamp
                                          ? new Date(row.timestamp).toLocaleString()
                                          : undefined
                                      }
                                    >
                                      {relative(row.timestamp)}
                                    </span>
                                    {row.meta && <span>{row.meta}</span>}
                                  </div>
                                  {row.error && (
                                    <p className="text-xs text-destructive break-all font-mono">
                                      {row.error}
                                    </p>
                                  )}
                                </div>
                              ))
                            )}
                          </div>
                        )}
                      </div>
                    </>
                  )}
                </Card>

              </li>
            );
          })}
        </ol>

        <div className="mt-6 flex flex-wrap justify-end gap-2">
          <Button variant="outline" size="sm" onClick={() => navigate("/admin/compatibility")}>
            <CheckCircle2 className="mr-1 h-4 w-4" />
            Ingestion compatibility tests
          </Button>
          <Button variant="outline" size="sm" onClick={() => navigate("/admin/semantic")}>
            <Radio className="mr-1 h-4 w-4" />
            SonicSIM Analysis Results
          </Button>
        </div>


        <div className="mt-6 space-y-4">
          <IngestByKeyPanel />
          <EnrichmentReadinessPanel />
          <IngestDebugPanel />
        </div>


      </main>

    </div>
  );
};

export default IntegrationStatus;
