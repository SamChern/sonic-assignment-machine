import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { AlertTriangle, BellRing, Check, Loader2, RefreshCw, Sparkles } from "lucide-react";

interface Nudge {
  id: string;
  title: string;
  detail: string;
  metric: number;
  threshold: number;
  severity: "ok" | "warn" | "critical";
  refresh: boolean;
  action: string;
}

interface NudgeReport {
  nudges: Nudge[];
  triggered: boolean;
  severity: "ok" | "warn" | "critical";
  metrics: {
    pending: number;
    failed: number;
    unreviewed: number;
    min_coverage_pct: number;
    weakest_branch: string | null;
    hours_since_run: number | null;
  };
  thresholds: {
    max_pending: number;
    min_coverage_pct: number;
    max_unreviewed: number;
    stale_hours: number;
  };
  state?: { paused?: boolean; pause_reason?: string | null };
  refreshed?: boolean;
  outcome?: { resolved?: number; failed?: number; remaining?: number; halted?: string | null } | null;
}

/**
 * The resolver nudge. Polls the signal-health thresholds and, when signals fall
 * below them, says exactly which one broke and offers the one-click agent
 * refresh that fixes it.
 */
export const ResolverNudge = ({ compact = false }: { compact?: boolean }) => {
  const [report, setReport] = useState<NudgeReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const call = useCallback(async (refresh: boolean) => {
    const { data, error } = await supabase.functions.invoke("signal-resolver", {
      body: { action: "nudge", refresh },
    });
    if (error) throw error;
    const res = data as NudgeReport & { success?: boolean; error?: string };
    if (res?.success === false) throw new Error(res.error ?? "nudge check failed");
    return res;
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setReport(await call(false));
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [call]);

  useEffect(() => {
    void load();
  }, [load]);

  const fireRefresh = async () => {
    setRefreshing(true);
    try {
      const res = await call(true);
      setReport(res);
      if (res.refreshed) {
        const o = res.outcome ?? {};
        toast.success(
          `Agent refresh: resolved ${o.resolved ?? 0}, ${o.remaining ?? 0} still queued${
            o.halted ? ` · halted: ${o.halted}` : ""
          }`,
        );
      } else if (res.state?.paused) {
        toast.error(`Resolver is paused — ${res.state.pause_reason ?? "check credits or policy"}`);
      } else {
        toast.info("Nothing to refresh: every signal is above its threshold.");
      }
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setRefreshing(false);
    }
  };

  const tone =
    report?.severity === "critical"
      ? "border-destructive/40 bg-destructive/5"
      : report?.severity === "warn"
      ? "border-amber-500/40 bg-amber-500/5"
      : "border-primary/20 bg-card/70";

  return (
    <Card className={`space-y-3 p-4 backdrop-blur ${tone}`}>
      <div className="flex flex-wrap items-center gap-2">
        {report?.severity === "ok" ? (
          <Check className="h-4 w-4 text-primary" />
        ) : (
          <BellRing className="h-4 w-4 text-amber-500" />
        )}
        <h3 className="text-sm font-semibold">Resolver nudge</h3>
        {report && (
          <Badge variant="outline" className="text-[10px]">
            {report.nudges.length
              ? `${report.nudges.length} signal${report.nudges.length > 1 ? "s" : ""} below threshold`
              : "signals healthy"}
          </Badge>
        )}
        <div className="ml-auto flex gap-1">
          <Button size="sm" variant="ghost" className="h-7 text-[11px]" onClick={load}>
            {loading ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <RefreshCw className="h-3 w-3" />
            )}
          </Button>
          <Button
            size="sm"
            variant={report?.triggered ? "default" : "outline"}
            className="h-7 text-[11px]"
            disabled={refreshing || !report?.triggered}
            onClick={fireRefresh}
          >
            {refreshing ? (
              <Loader2 className="mr-1 h-3 w-3 animate-spin" />
            ) : (
              <Sparkles className="mr-1 h-3 w-3" />
            )}
            Refresh signals
          </Button>
        </div>
      </div>

      {report && (
        <div className="grid grid-cols-2 gap-2 text-[11px] text-muted-foreground sm:grid-cols-4">
          <span>
            {report.metrics.pending} queued / {report.thresholds.max_pending}
          </span>
          <span>
            {report.metrics.min_coverage_pct}% grounded / {report.thresholds.min_coverage_pct}%
          </span>
          <span>
            {report.metrics.unreviewed} unreviewed / {report.thresholds.max_unreviewed}
          </span>
          <span>
            {report.metrics.hours_since_run === null
              ? "never run"
              : `${Math.round(report.metrics.hours_since_run)}h since run`}
          </span>
        </div>
      )}

      {!compact &&
        (report?.nudges ?? []).map((n) => (
          <div
            key={n.id}
            className="rounded-lg border border-border/60 bg-muted/20 p-2 text-[11px]"
          >
            <div className="flex items-center gap-1.5">
              <AlertTriangle
                className={`h-3 w-3 ${
                  n.severity === "critical" ? "text-destructive" : "text-amber-500"
                }`}
              />
              <span className="text-xs font-medium">{n.title}</span>
              <Badge variant="outline" className="ml-auto px-1 py-0 text-[9px]">
                {n.refresh ? "agent refresh" : "needs review"}
              </Badge>
            </div>
            <p className="mt-1 text-muted-foreground">{n.detail}</p>
          </div>
        ))}

      {report && !report.nudges.length && !loading && (
        <p className="text-[11px] text-muted-foreground">
          Every signal is above its threshold — no refresh needed.
        </p>
      )}
    </Card>
  );
};

export default ResolverNudge;
