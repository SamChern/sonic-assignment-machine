import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Activity, RefreshCw, Play, Layers } from "lucide-react";


interface Metrics {
  total: number;
  hits: number;
  errors: number;
  throttled: number;
  p50: number | null;
  p95: number | null;
  queueDepth: number;
  queueFailed: number;
  cacheReady: number;
  cachePending: number;
}

const EMPTY: Metrics = {
  total: 0,
  hits: 0,
  errors: 0,
  throttled: 0,
  p50: null,
  p95: null,
  queueDepth: 0,
  queueFailed: 0,
  cacheReady: 0,
  cachePending: 0,
};

function percentile(sorted: number[], p: number): number | null {
  if (sorted.length === 0) return null;
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

export function LibrosaHealthPanel() {
  const { user, isAdmin } = useAuth();
  const [metrics, setMetrics] = useState<Metrics>(EMPTY);
  const [loading, setLoading] = useState(false);
  const [draining, setDraining] = useState(false);
  const [backfilling, setBackfilling] = useState(false);
  const canRead = !!user && isAdmin;
  const canReadRef = useRef(canRead);
  canReadRef.current = canRead;

  const load = useCallback(async () => {
    // These tables are admin-only under RLS — never spend a round trip otherwise.
    if (!canReadRef.current) return;
    setLoading(true);
    const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();


    const [logs, jobsPending, jobsFailed, cacheReady, cachePending] = await Promise.all([
      supabase
        .from("librosa_call_log")
        .select("outcome, cache_hit, duration_ms")
        .gte("created_at", since)
        .order("created_at", { ascending: false })
        .limit(1000),
      supabase
        .from("analysis_jobs")
        .select("id", { count: "exact", head: true })
        .in("status", ["pending", "processing"]),
      supabase
        .from("analysis_jobs")
        .select("id", { count: "exact", head: true })
        .eq("status", "failed"),
      supabase
        .from("librosa_cache")
        .select("cache_key", { count: "exact", head: true })
        .eq("status", "ready"),
      supabase
        .from("librosa_cache")
        .select("cache_key", { count: "exact", head: true })
        .eq("status", "pending"),
    ]);

    const rows = logs.data ?? [];
    const durations = rows
      .filter((r) => !r.cache_hit && typeof r.duration_ms === "number")
      .map((r) => r.duration_ms as number)
      .sort((a, b) => a - b);

    setMetrics({
      total: rows.length,
      hits: rows.filter((r) => r.cache_hit).length,
      errors: rows.filter((r) => r.outcome === "error").length,
      throttled: rows.filter(
        (r) => r.outcome === "throttled" || r.outcome === "breaker_open",
      ).length,
      p50: percentile(durations, 50),
      p95: percentile(durations, 95),
      queueDepth: jobsPending.count ?? 0,
      queueFailed: jobsFailed.count ?? 0,
      cacheReady: cacheReady.count ?? 0,
      cachePending: cachePending.count ?? 0,
    });
    setLoading(false);
  }, []);

  useEffect(() => {
    if (!canRead) return;
    load();
    // Poll only while the tab is visible, and refresh immediately on return —
    // background tabs otherwise burn 5 queries every interval.
    const t = setInterval(() => {
      if (document.visibilityState === "visible") load();
    }, 60_000);
    const onVisible = () => {
      if (document.visibilityState === "visible") load();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [load, canRead]);


  const drain = async () => {
    setDraining(true);
    const { data, error } = await supabase.functions.invoke<{
      success: boolean;
      processed?: number;
      ok?: number;
      failed?: number;
      skipped?: string;
      error?: string;
    }>("librosa-worker", { body: {} });
    setDraining(false);
    if (error || !data?.success) {
      toast.error(data?.error ?? error?.message ?? "Worker run failed");
    } else if (data.skipped) {
      toast.warning(`Worker skipped: ${data.skipped}`);
    } else {
      toast.success(`Worker processed ${data.processed ?? 0} job(s)`);
    }
    load();
  };

  // Phase 2 — warm the shared cache at a trickle rate so future requests hit
  // the cache instead of the analysis service.
  const backfill = async () => {
    setBackfilling(true);
    const { data, error } = await supabase.functions.invoke<{
      success: boolean;
      queued?: number;
      already_cached?: number;
      skipped?: number;
      error?: string;
    }>("librosa-backfill", { body: { limit: 25 } });
    setBackfilling(false);
    if (error || !data?.success) {
      toast.error(data?.error ?? error?.message ?? "Backfill failed");
    } else {
      toast.success(
        `Queued ${data.queued ?? 0} • attached from cache ${data.already_cached ?? 0} • skipped ${data.skipped ?? 0}`,
      );
    }
    load();
  };

  const hitRate = metrics.total > 0 ? Math.round((metrics.hits / metrics.total) * 100) : 0;
  const errorRate =
    metrics.total > 0 ? Math.round((metrics.errors / metrics.total) * 100) : 0;

  return (
    <Card className="p-5 space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Activity className="h-4 w-4 text-primary" />
          <h3 className="font-semibold">Analysis pipeline health</h3>
          <span className="text-xs text-muted-foreground">last 24h</span>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={load} disabled={loading}>
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          </Button>
          <Button variant="outline" size="sm" onClick={backfill} disabled={backfilling}>
            <Layers className="h-3.5 w-3.5 mr-1" />
            {backfilling ? "Warming…" : "Warm cache"}
          </Button>
          <Button variant="outline" size="sm" onClick={drain} disabled={draining}>
            <Play className="h-3.5 w-3.5 mr-1" />
            {draining ? "Running…" : "Run queue"}
          </Button>
        </div>
      </div>


      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Metric label="Cache hit rate" value={`${hitRate}%`} accent={hitRate >= 50} />
        <Metric label="Error rate" value={`${errorRate}%`} accent={errorRate === 0} />
        <Metric
          label="Upstream p50"
          value={metrics.p50 !== null ? `${(metrics.p50 / 1000).toFixed(1)}s` : "—"}
        />
        <Metric
          label="Upstream p95"
          value={metrics.p95 !== null ? `${(metrics.p95 / 1000).toFixed(1)}s` : "—"}
        />
      </div>

      <div className="flex flex-wrap gap-2 text-xs">
        <Badge variant="secondary">Queue depth: {metrics.queueDepth}</Badge>
        <Badge variant="secondary">Failed jobs: {metrics.queueFailed}</Badge>
        <Badge variant="secondary">Cached results: {metrics.cacheReady}</Badge>
        <Badge variant="secondary">In flight: {metrics.cachePending}</Badge>
        <Badge variant="secondary">Throttled/degraded: {metrics.throttled}</Badge>
        <Badge variant="secondary">Calls logged: {metrics.total}</Badge>
      </div>
    </Card>
  );
}

function Metric({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div className="rounded-lg border border-border bg-muted/30 p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div
        className={`text-lg font-semibold ${
          accent === undefined ? "" : accent ? "text-primary" : "text-destructive"
        }`}
      >
        {value}
      </div>
    </div>
  );
}
