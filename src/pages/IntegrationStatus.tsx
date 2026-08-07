import { useEffect, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  ArrowLeft,
  RefreshCw,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  CircleDashed,
  Activity,
} from "lucide-react";

type Health = "ok" | "warn" | "error" | "idle";

interface Stage {
  key: string;
  title: string;
  subtitle: string;
  health: Health;
  lastRunAt: string | null;
  metrics: { label: string; value: string }[];
  note?: string;
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

  useEffect(() => {
    if (!loading) {
      if (!user) navigate("/auth");
      else if (!isAdmin) navigate("/");
    }
  }, [loading, user, isAdmin, navigate]);

  const load = useCallback(async () => {
    setRefreshing(true);
    const [batches, jobs, nodes, analyses, calibration, callLog, cache] =
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
      ]);

    const batchRows = batches.data ?? [];
    const jobRows = jobs.data ?? [];
    const nodeRows = nodes.data ?? [];
    const analysisRows = analyses.data ?? [];
    const calibrationRows = calibration.data ?? [];
    const logRows = callLog.data ?? [];
    const cacheRows = cache.data ?? [];

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
      },
      {
        key: "s3",
        title: "S3 inbound drop",
        subtitle: "Nightly object landing in the shared inbound bucket",
        health: lastBatch
          ? lastBatch.file_uri
            ? staleness(lastBatch.created_at, 48)
            : "warn"
          : "idle",
        lastRunAt: lastBatch?.created_at ?? null,
        metrics: [
          { label: "Latest object", value: lastBatch?.file_uri ?? "manual upload" },
          { label: "Failed deliveries", value: String(failedBatches) },
        ],
        note:
          lastBatch && !lastBatch.file_uri
            ? "Latest batch arrived by manual upload rather than an S3 object."
            : undefined,
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
      },
    ];

    setStages(next);
    setFetchedAt(new Date());
    setRefreshing(false);
  }, []);

  useEffect(() => {
    if (isAdmin) load();
  }, [isAdmin, load]);

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
        <div className="container mx-auto px-6 py-4 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="sm" onClick={() => navigate("/admin")}>
              <ArrowLeft className="h-4 w-4 mr-1" /> Back
            </Button>
            <div className="flex items-center gap-2">
              <Activity className="h-5 w-5 text-primary" />
              <h1 className="text-xl font-semibold">Integration Status</h1>
            </div>
          </div>
          <div className="flex items-center gap-3">
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

      <main className="container mx-auto px-6 py-8 max-w-4xl space-y-4">
        <p className="text-sm text-muted-foreground">
          End-to-end pipeline health from the Intuizi console through to outbound
          segment activation. Each stage reports its most recent run and the
          counters used to judge whether it is keeping up.
        </p>

        <ol className="space-y-4">
          {stages.map((stage, index) => {
            const meta = HEALTH_META[stage.health];
            const Icon = meta.icon;
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
                    <div className="flex flex-col items-end gap-1">
                      <Badge variant="outline" className={`gap-1 ${meta.className}`}>
                        <Icon className="h-3 w-3" /> {meta.label}
                      </Badge>
                      <span
                        className="text-xs text-muted-foreground"
                        title={stage.lastRunAt ? new Date(stage.lastRunAt).toLocaleString() : undefined}
                      >
                        Last run {relative(stage.lastRunAt)}
                      </span>
                    </div>
                  </div>

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
                </Card>
              </li>
            );
          })}
        </ol>
      </main>
    </div>
  );
};

export default IntegrationStatus;
