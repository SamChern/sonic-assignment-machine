import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Slider } from "@/components/ui/slider";
import { toast } from "@/hooks/use-toast";
import { FunctionsHttpError } from "@supabase/supabase-js";
import sonicSimLogo from "@/assets/SonicSIM_blend.png";
import {
  ArrowLeft,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  CircleDashed,
  Loader2,
  RefreshCw,
  ShieldCheck,
  ChevronDown,
  Wrench,
  Bug,
  PlayCircle,
} from "lucide-react";

type Status = "pass" | "warn" | "fail" | "skip";

interface Check {
  id: string;
  feed: string;
  title: string;
  status: Status;
  detail: string;
  expected?: string;
  actual?: string;
  remediation?: string;
  evidence?: Record<string, unknown>;
  debug?: Record<string, unknown>;
}

type Scope = "all" | "object_store" | "intuizi" | "ec2_analysis" | "librosa_rest";

/** Per-source test targets — feed labels come back from the function verbatim. */
const SOURCES: { scope: Exclude<Scope, "all">; label: string; feed: string }[] = [
  { scope: "object_store", label: "S3 object store", feed: "object store" },
  { scope: "intuizi", label: "Intuizi deliveries", feed: "intuizi" },
  { scope: "ec2_analysis", label: "EC2 analysis API", feed: "EC2 analysis API" },
  { scope: "librosa_rest", label: "Librosa REST", feed: "Librosa REST" },
];

const scopeForFeed = (feed: string): Exclude<Scope, "all"> =>
  SOURCES.find((s) => s.feed === feed)?.scope ?? "intuizi";

interface SampledObject {
  key: string;
  report_type: string;
  size: number;
  last_modified: string | null;
  rows_read: number;
  columns: string[];
  rows_with_identifier: number;
  summary_rows: number;
  roster_rows: number;
  normalized_rows: number;
}

interface Report {
  ran_at: string;
  duration_ms: number;
  scope?: Scope;
  debug?: boolean;
  trace?: { at: number; step: string; detail?: unknown }[];
  backend?: { backend: string; configured: boolean; placeholder: boolean };
  discovered_objects?: number;
  summary: { pass: number; warn: number; fail: number; skip: number; total: number; verdict: string };
  checks: Check[];
  objects_sampled: SampledObject[];
}

const STATUS_META: Record<Status, { label: string; icon: typeof CheckCircle2; className: string }> = {
  pass: { label: "Pass", icon: CheckCircle2, className: "bg-primary/15 text-primary border-primary/30" },
  warn: { label: "Mismatch", icon: AlertTriangle, className: "bg-amber-500/15 text-amber-500 border-amber-500/30" },
  fail: { label: "Blocking", icon: XCircle, className: "bg-destructive/15 text-destructive border-destructive/30" },
  skip: { label: "Not applicable", icon: CircleDashed, className: "bg-muted text-muted-foreground border-border" },
};

const VERDICT_COPY: Record<string, string> = {
  compatible: "All standardized checks passed — feeds are ready for semantic analysis.",
  degraded: "Feeds are ingestible but some schema/metadata contracts drifted.",
  incompatible: "Blocking mismatches found — these deliveries will not be scored until fixed.",
};

const ORDER: Status[] = ["fail", "warn", "pass", "skip"];

/** Replace only the checks/samples belonging to the feeds a scoped run covered. */
function mergeReport(prev: Report, next: Report): Report {
  const feeds = new Set(next.checks.map((c) => c.feed));
  const kept = prev.checks.filter((c) => !feeds.has(c.feed));
  const checks = [...kept, ...next.checks];
  const summary = checks.reduce(
    (acc, c) => ({ ...acc, [c.status]: acc[c.status] + 1, total: acc.total + 1 }),
    { pass: 0, warn: 0, fail: 0, skip: 0, total: 0 } as Report["summary"],
  );
  summary.verdict = summary.fail > 0 ? "incompatible" : summary.warn > 0 ? "degraded" : "compatible";
  const sampled = next.objects_sampled.length ? next.objects_sampled : prev.objects_sampled;
  return {
    ...prev,
    ...next,
    summary,
    checks,
    objects_sampled: sampled,
    trace: next.trace ?? prev.trace,
  };
}

interface ParallelResult {
  scope: Exclude<Scope, "all">;
  label: string;
  ok: boolean;
  ms: number;
  counts?: Report["summary"];
  error?: string;
}

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
            <img src={sonicSimLogo} alt="SonicSIM" className="h-7 w-auto" />
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

        <Card className="border-border/60 bg-card/60 p-5 backdrop-blur-sm">
          <div className="grid gap-6 sm:grid-cols-2">
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="font-medium">Objects probed per run</span>
                <span className="text-muted-foreground">{maxObjects}</span>
              </div>
              <Slider
                value={[maxObjects]}
                min={1}
                max={8}
                step={1}
                onValueChange={([v]) => setMaxObjects(v)}
              />
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="font-medium">Rows sampled per object</span>
                <span className="text-muted-foreground">{maxRows}</span>
              </div>
              <Slider
                value={[maxRows]}
                min={20}
                max={2000}
                step={20}
                onValueChange={([v]) => setMaxRows(v)}
              />
            </div>
          </div>
        </Card>

        <Card className="border-border/60 bg-card/60 p-5 backdrop-blur-sm">
          <h2 className="mb-3 text-sm font-semibold">Per-source tests</h2>
          <ul className="space-y-2">
            {SOURCES.map((src) => {
              const feedChecks = report?.checks.filter((c) => c.feed === src.feed) ?? [];
              const worst: Status | null = feedChecks.length
                ? (["fail", "warn", "pass", "skip"] as Status[]).find((s) =>
                    feedChecks.some((c) => c.status === s),
                  ) ?? null
                : null;
              const last = lastRun[src.feed];
              const busy = running && runningScope === src.scope;
              return (
                <li
                  key={src.scope}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border/60 bg-background/40 p-3"
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium">{src.label}</span>
                      {worst && (
                        <Badge variant="outline" className={`text-[10px] ${STATUS_META[worst].className}`}>
                          {STATUS_META[worst].label}
                        </Badge>
                      )}
                      {last?.debug && (
                        <Badge variant="outline" className="text-[10px]">debug</Badge>
                      )}
                    </div>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {feedChecks.length
                        ? `${feedChecks.length} check(s)`
                        : "Not tested yet"}
                      {last && ` · ran ${new Date(last.at).toLocaleTimeString()} in ${last.ms}ms`}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => run(src.scope)}
                      disabled={running}
                    >
                      {busy ? (
                        <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <PlayCircle className="mr-2 h-3.5 w-3.5" />
                      )}
                      Run tests
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => run(src.scope, true)}
                      disabled={running}
                    >
                      <Bug className="mr-2 h-3.5 w-3.5 text-primary" />
                      Rerun with debug
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        </Card>

        {report && (
          <Card className="border-border/60 bg-card/60 p-5 backdrop-blur-sm">
            <div className="flex flex-wrap items-center gap-2">
              {(["all", "fail", "warn", "pass", "skip"] as const).map((s) => {
                const count = s === "all"
                  ? report.summary.total
                  : report.summary[s as Status];
                return (
                  <Button
                    key={s}
                    size="sm"
                    variant={statusFilter === s ? "default" : "outline"}
                    onClick={() => setStatusFilter(s)}
                  >
                    {s === "all" ? "All" : STATUS_META[s as Status].label} ({count})
                  </Button>
                );
              })}
            </div>
            <p className="mt-3 text-sm text-muted-foreground">
              {VERDICT_COPY[report.summary.verdict] ?? ""}{" "}
              {report.backend && (
                <>Backend <span className="font-medium text-foreground">{report.backend.backend}</span>.{" "}</>
              )}
              {report.discovered_objects != null && (
                <>{report.discovered_objects} object(s) discovered.{" "}</>
              )}
              Ran {new Date(report.ran_at).toLocaleTimeString()} in {report.duration_ms}ms.
            </p>
          </Card>
        )}

        {running && !report && (
          <Card className="flex items-center gap-3 border-border/60 bg-card/60 p-5">
            <Loader2 className="h-4 w-4 animate-spin text-primary" />
            <span className="text-sm text-muted-foreground">Running compatibility tests…</span>
          </Card>
        )}

        {feeds.map(({ feed, checks }) => (
          <Card key={feed} className="border-border/60 bg-card/60 p-5 backdrop-blur-sm">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                {feed}
              </h2>
              <div className="flex items-center gap-1">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => run(scopeForFeed(feed))}
                  disabled={running}
                >
                  {running && runningScope === scopeForFeed(feed) ? (
                    <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <RefreshCw className="mr-2 h-3.5 w-3.5" />
                  )}
                  Run tests
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => run(scopeForFeed(feed), true)}
                  disabled={running}
                >
                  <Bug className="mr-2 h-3.5 w-3.5 text-primary" />
                  Rerun with debug
                </Button>
              </div>
            </div>
            <ul className="space-y-2">
              {checks.map((c) => {
                const meta = STATUS_META[c.status];
                const Icon = meta.icon;
                const isOpen = !!open[c.id];
                const hasDetail = !!(c.expected || c.actual || c.remediation || c.evidence || c.debug);
                return (
                  <li key={c.id} className="rounded-lg border border-border/60 bg-background/40">
                    <button
                      type="button"
                      className="flex w-full items-start gap-3 p-3 text-left"
                      onClick={() => setOpen((p) => ({ ...p, [c.id]: !p[c.id] }))}
                    >
                      <Icon
                        className={`mt-0.5 h-4 w-4 shrink-0 ${
                          c.status === "pass"
                            ? "text-primary"
                            : c.status === "warn"
                            ? "text-amber-500"
                            : c.status === "fail"
                            ? "text-destructive"
                            : "text-muted-foreground"
                        }`}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-medium">{c.title}</span>
                          <Badge variant="outline" className={`text-[10px] ${meta.className}`}>
                            {meta.label}
                          </Badge>
                        </span>
                        <span className="mt-1 block break-words text-xs text-muted-foreground">
                          {c.detail}
                        </span>
                      </span>
                      {hasDetail && (
                        <ChevronDown
                          className={`mt-0.5 h-4 w-4 shrink-0 text-muted-foreground transition-transform ${
                            isOpen ? "rotate-180" : ""
                          }`}
                        />
                      )}
                    </button>

                    {isOpen && hasDetail && (
                      <div className="space-y-2 border-t border-border/60 p-3 text-xs">
                        {c.expected && (
                          <div>
                            <span className="font-medium text-muted-foreground">Expected: </span>
                            <span className="break-words font-mono">{c.expected}</span>
                          </div>
                        )}
                        {c.actual && (
                          <div>
                            <span className="font-medium text-muted-foreground">Actual: </span>
                            <span className="break-words font-mono">{c.actual}</span>
                          </div>
                        )}
                        {c.remediation && (
                          <div className="rounded-md border border-primary/30 bg-primary/5 p-2">
                            <span className="flex items-center gap-1 font-medium text-primary">
                              <Wrench className="h-3 w-3" /> Remediation
                            </span>
                            <p className="mt-1 break-words text-muted-foreground">{c.remediation}</p>
                          </div>
                        )}
                        {c.evidence && (
                          <pre className="max-h-40 overflow-auto rounded-md bg-muted/40 p-2 font-mono text-[10px] leading-relaxed">
                            {JSON.stringify(c.evidence, null, 2)}
                          </pre>
                        )}
                        {c.debug && (
                          <div className="rounded-md border border-primary/20 bg-primary/5 p-2">
                            <span className="flex items-center gap-1 font-medium text-primary">
                              <Bug className="h-3 w-3" /> Debug
                            </span>
                            <pre className="mt-1 max-h-56 overflow-auto font-mono text-[10px] leading-relaxed">
                              {JSON.stringify(c.debug, null, 2)}
                            </pre>
                          </div>
                        )}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </Card>
        ))}

        {remediations.length > 0 && (
          <Card className="border-border/60 bg-card/60 p-5 backdrop-blur-sm">
            <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold">
              <Wrench className="h-4 w-4 text-primary" />
              Remediation checklist ({remediations.length})
            </h2>
            <ol className="space-y-2 text-xs">
              {remediations.map((c, i) => (
                <li key={c.id} className="flex gap-2">
                  <span className="text-muted-foreground">{i + 1}.</span>
                  <span>
                    <span className="font-medium">{c.title}</span>
                    <span className="block text-muted-foreground">{c.remediation}</span>
                  </span>
                </li>
              ))}
            </ol>
          </Card>
        )}

        {report && report.objects_sampled.length > 0 && (
          <Card className="border-border/60 bg-card/60 p-5 backdrop-blur-sm">
            <h2 className="mb-3 text-sm font-semibold">Probed deliveries</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="text-muted-foreground">
                  <tr className="border-b border-border/60">
                    <th className="py-2 pr-3 font-medium">Object</th>
                    <th className="py-2 pr-3 font-medium">Type</th>
                    <th className="py-2 pr-3 font-medium">Rows</th>
                    <th className="py-2 pr-3 font-medium">With id</th>
                    <th className="py-2 pr-3 font-medium">Summary</th>
                    <th className="py-2 pr-3 font-medium">Roster</th>
                    <th className="py-2 pr-3 font-medium">Tagged</th>
                    <th className="py-2 font-medium">Columns</th>
                  </tr>
                </thead>
                <tbody>
                  {report.objects_sampled.map((o) => (
                    <tr key={o.key} className="border-b border-border/40 last:border-0">
                      <td className="max-w-[220px] truncate py-2 pr-3 font-mono" title={o.key}>
                        {o.key.split("/").pop()}
                      </td>
                      <td className="py-2 pr-3">{o.report_type}</td>
                      <td className="py-2 pr-3">{o.rows_read}</td>
                      <td className="py-2 pr-3">{o.rows_with_identifier}</td>
                      <td className="py-2 pr-3">{o.summary_rows}</td>
                      <td className="py-2 pr-3">{o.roster_rows}</td>
                      <td className="py-2 pr-3">{o.normalized_rows}</td>
                      <td className="max-w-[260px] truncate py-2" title={o.columns.join(", ")}>
                        {o.columns.length}: {o.columns.slice(0, 4).join(", ")}
                        {o.columns.length > 4 ? "…" : ""}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )}
        {report?.trace && report.trace.length > 0 && (
          <Card className="border-border/60 bg-card/60 p-5 backdrop-blur-sm">
            <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold">
              <Bug className="h-4 w-4 text-primary" /> Debug trace ({report.trace.length} step(s))
            </h2>
            <pre className="max-h-64 overflow-auto rounded-md bg-muted/40 p-2 font-mono text-[10px] leading-relaxed">
              {report.trace.map((t) => `+${t.at}ms  ${t.step}${
                t.detail !== undefined ? `  ${JSON.stringify(t.detail)}` : ""
              }`).join("\n")}
            </pre>
          </Card>
        )}
      </main>
    </div>
  );
};

export default IngestionCompatibility;
