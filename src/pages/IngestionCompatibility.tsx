import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/hooks/use-toast";

import { FunctionsHttpError } from "@supabase/supabase-js";
import sonicSimLogo from "@/assets/SonicSIM_blend.png";
import {
  ArrowLeft,
  Loader2,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";

import {
  type Check,
  mergeReport,
  ORDER,
  type Report,
  type Scope,
  SOURCES,
  type Status,
} from "@/lib/compatibilityReport";
import { STATUS_META } from "@/components/admin/compatibility/statusMeta";
import { type ParallelResult } from "@/components/admin/compatibility/types";
import { RunSettingsCard } from "@/components/admin/compatibility/RunSettingsCard";
import { SourcesPanel } from "@/components/admin/compatibility/SourcesPanel";
import { ParallelSummaryCard } from "@/components/admin/compatibility/ParallelSummaryCard";
import { SummaryFilterCard } from "@/components/admin/compatibility/SummaryFilterCard";
import { FeedChecksCard } from "@/components/admin/compatibility/FeedChecksCard";
import { RemediationChecklistCard } from "@/components/admin/compatibility/RemediationChecklistCard";
import { ProbedObjectsCard } from "@/components/admin/compatibility/ProbedObjectsCard";
import { DebugTraceCard } from "@/components/admin/compatibility/DebugTraceCard";

const IngestionCompatibility = () => {
  const { isAdmin, loading } = useAuth();
  const navigate = useNavigate();
  const [running, setRunning] = useState(false);
  const [runningScope, setRunningScope] = useState<Scope | null>(null);
  const [runningScopes, setRunningScopes] = useState<string[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [parallel, setParallel] = useState<{
    at: string;
    ms: number;
    debug: boolean;
    results: ParallelResult[];
  } | null>(null);
  const [lastRun, setLastRun] = useState<Record<string, { at: string; debug: boolean; ms: number }>>({});
  const [report, setReport] = useState<Report | null>(null);
  const [maxObjects, setMaxObjects] = useState(3);
  const [maxRows, setMaxRows] = useState(300);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [statusFilter, setStatusFilter] = useState<Status | "all">("all");

  useEffect(() => {
    if (!loading && !isAdmin) navigate("/");
  }, [loading, isAdmin, navigate]);

  const invokeRun = useCallback(
    async (scope: Scope, debug: boolean): Promise<Report> => {
      const { data, error } = await supabase.functions.invoke("ingestion-compatibility", {
        body: { maxObjects, maxRowsPerObject: maxRows, scope, debug },
      });
      if (error) {
        const details =
          error instanceof FunctionsHttpError ? await error.context.text() : error.message;
        throw new Error(details);
      }
      return data as Report;
    },
    [maxObjects, maxRows],
  );

  const stampFeeds = useCallback((next: Report, debug: boolean) => {
    const feeds = [...new Set(next.checks.map((c) => c.feed))];
    setLastRun((prev) => {
      const stamped = { at: next.ran_at, debug, ms: next.duration_ms };
      const merged = { ...prev };
      for (const f of feeds) merged[f] = stamped;
      return merged;
    });
  }, []);

  const run = useCallback(
    async (scope: Scope = "all", debug = false) => {
      setRunning(true);
      setRunningScope(scope);
      try {
        const next = await invokeRun(scope, debug);
        setReport((prev) => (scope === "all" || !prev ? next : mergeReport(prev, next)));
        stampFeeds(next, debug);
        if (scope !== "all") {
          toast({
            title: debug ? "Debug rerun complete" : "Tests complete",
            description: `${next.summary.pass} pass · ${next.summary.warn} mismatch · ${next.summary.fail} blocking (${next.duration_ms}ms)`,
          });
        }
      } catch (e) {
        toast({
          title: "Compatibility run failed",
          description: e instanceof Error ? e.message : "Unknown error",
          variant: "destructive",
        });
      } finally {
        setRunning(false);
        setRunningScope(null);
      }
    },
    [invokeRun, stampFeeds],
  );

  /** Fan out every selected source concurrently, then merge + summarize. */
  const runSelected = useCallback(
    async (debug = false) => {
      const targets = SOURCES.filter((s) => selected.includes(s.scope));
      if (targets.length === 0) {
        toast({ title: "No sources selected", description: "Pick at least one source to test." });
        return;
      }
      setRunning(true);
      setRunningScopes(targets.map((t) => t.scope));
      setParallel(null);
      const startedAt = performance.now();
      const settled = await Promise.all(
        targets.map(async (t): Promise<ParallelResult & { report?: Report }> => {
          const t0 = performance.now();
          try {
            const rep = await invokeRun(t.scope, debug);
            return {
              scope: t.scope,
              label: t.label,
              ok: true,
              ms: Math.round(performance.now() - t0),
              counts: rep.summary,
              report: rep,
            };
          } catch (e) {
            return {
              scope: t.scope,
              label: t.label,
              ok: false,
              ms: Math.round(performance.now() - t0),
              error: e instanceof Error ? e.message : "Unknown error",
            };
          }
        }),
      );

      const good = settled.filter((r) => r.report);
      if (good.length) {
        setReport((prev) => {
          let acc = prev ?? good[0].report!;
          for (const r of good) acc = mergeReport(acc, r.report!);
          return acc;
        });
        for (const r of good) stampFeeds(r.report!, debug);
      }
      setParallel({
        at: new Date().toISOString(),
        ms: Math.round(performance.now() - startedAt),
        debug,
        results: settled.map(({ report: _r, ...rest }) => rest),
      });
      setRunning(false);
      setRunningScopes([]);
      const failed = settled.filter((r) => !r.ok).length;
      toast({
        title: debug ? "Parallel debug run complete" : "Parallel run complete",
        description: `${good.length}/${settled.length} source(s) succeeded${
          failed ? `, ${failed} errored` : ""
        } in ${Math.round(performance.now() - startedAt)}ms`,
        variant: failed ? "destructive" : undefined,
      });
    },
    [selected, invokeRun, stampFeeds],
  );

  useEffect(() => {
    if (isAdmin) void run("all");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin]);


  const feeds = useMemo(() => {
    if (!report) return [] as { feed: string; checks: Check[] }[];
    const map = new Map<string, Check[]>();
    for (const c of report.checks) {
      if (statusFilter !== "all" && c.status !== statusFilter) continue;
      if (!map.has(c.feed)) map.set(c.feed, []);
      map.get(c.feed)!.push(c);
    }
    return [...map.entries()].map(([feed, checks]) => ({
      feed,
      checks: [...checks].sort((a, b) => ORDER.indexOf(a.status) - ORDER.indexOf(b.status)),
    }));
  }, [report, statusFilter]);

  const remediations = useMemo(
    () => (report?.checks ?? []).filter((c) => c.remediation && c.status !== "pass"),
    [report],
  );

  if (loading || !isAdmin) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen gradient-app">
      <header className="sticky top-0 z-20 border-b border-border/60 bg-background/70 backdrop-blur-md">
        <div className="container mx-auto flex flex-wrap items-center justify-between gap-3 px-6 py-4">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="sm" onClick={() => navigate("/admin/pipeline")}>
              <ArrowLeft className="mr-1 h-4 w-4" /> Back
            </Button>
            <img src={sonicSimLogo} alt="SonicSIM.ai" className="h-7 w-auto" />
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-5 w-5 text-primary" />
              <h1 className="text-lg font-semibold sm:text-xl">Ingestion compatibility</h1>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {report && (
              <Badge variant="outline" className={STATUS_META[
                report.summary.fail ? "fail" : report.summary.warn ? "warn" : "pass"
              ].className}>
                {report.summary.verdict}
              </Badge>
            )}
            <Button size="sm" onClick={() => run("all")} disabled={running}>
              {running ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="mr-2 h-4 w-4" />
              )}
              Run tests
            </Button>
          </div>
        </div>
      </header>

      <main className="container mx-auto max-w-5xl space-y-5 px-6 py-8">
        <p className="text-sm text-muted-foreground">
          Standardized, read-only tests against the object store and every configured
          alternate feed (Intuizi console deliveries, EC2 analysis API). Each failed
          contract lists what the pipeline expected, what the delivery actually contained,
          and how to fix it.
        </p>

        <RunSettingsCard
          maxObjects={maxObjects}
          setMaxObjects={setMaxObjects}
          maxRows={maxRows}
          setMaxRows={setMaxRows}
        />

        <SourcesPanel
          report={report}
          lastRun={lastRun}
          running={running}
          runningScope={runningScope}
          runningScopes={runningScopes}
          selected={selected}
          setSelected={setSelected}
          run={run}
          runSelected={runSelected}
        />

        {parallel && <ParallelSummaryCard parallel={parallel} />}

        {report && (
          <SummaryFilterCard
            report={report}
            statusFilter={statusFilter}
            setStatusFilter={setStatusFilter}
          />
        )}

        {running && !report && (
          <Card className="flex items-center gap-3 border-border/60 bg-card/60 p-5">
            <Loader2 className="h-4 w-4 animate-spin text-primary" />
            <span className="text-sm text-muted-foreground">Running compatibility tests…</span>
          </Card>
        )}

        {feeds.map(({ feed, checks }) => (
          <FeedChecksCard
            key={feed}
            feed={feed}
            checks={checks}
            running={running}
            runningScope={runningScope}
            open={open}
            setOpen={setOpen}
            run={run}
          />
        ))}

        {remediations.length > 0 && <RemediationChecklistCard remediations={remediations} />}

        {report && report.objects_sampled.length > 0 && (
          <ProbedObjectsCard objects={report.objects_sampled} />
        )}
        {report?.trace && report.trace.length > 0 && (
          <DebugTraceCard trace={report.trace} />
        )}
      </main>
    </div>
  );
};

export default IngestionCompatibility;
