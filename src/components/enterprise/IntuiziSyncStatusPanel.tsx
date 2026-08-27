import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { AlertTriangle, ChevronDown, ChevronRight, History, Loader2, RefreshCw } from "lucide-react";

interface SyncRun {
  id: string;
  activation_id: string;
  dataset_id: string | null;
  started_by: string | null;
  status: string;
  profiles_found: number;
  rows_synced: number;
  rows_scored: number;
  rows_failed: number;
  coverage_pct: number | null;
  error: string | null;
  started_at: string;
  finished_at: string | null;
}

interface Props {
  organizationId: string;
  /** bump to refetch after a sync completes */
  refreshKey?: number;
}

const statusTone = (status: string) => {
  if (status === "done") return "bg-primary/15 text-primary border-primary/30";
  if (status === "partial") return "bg-amber-500/15 text-amber-600 border-amber-500/30";
  if (status === "running") return "bg-sky-500/15 text-sky-600 border-sky-500/30";
  if (status === "failed") return "bg-destructive/15 text-destructive border-destructive/30";
  return "bg-muted text-muted-foreground border-border";
};

const IntuiziSyncStatusPanel = ({ organizationId, refreshKey = 0 }: Props) => {
  const [runs, setRuns] = useState<SyncRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("org_intuizi_sync_runs")
      .select(
        "id,activation_id,dataset_id,started_by,status,profiles_found,rows_synced,rows_scored,rows_failed,coverage_pct,error,started_at,finished_at",
      )
      .eq("organization_id", organizationId)
      .order("started_at", { ascending: false })
      .limit(60);
    setLoading(false);
    if (!error) setRuns((data ?? []) as SyncRun[]);
  }, [organizationId]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  // Latest run per activation drives the headline status; older ones are history.
  const byActivation = useMemo(() => {
    const groups = new Map<string, SyncRun[]>();
    for (const r of runs) {
      const list = groups.get(r.activation_id) ?? [];
      list.push(r);
      groups.set(r.activation_id, list);
    }
    return Array.from(groups.entries());
  }, [runs]);

  return (
    <Card className="border-border/60 bg-card/70 p-4 backdrop-blur-sm">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          <History className="h-4 w-4 text-primary" />
          Sync status &amp; audit log
        </h3>
        <Badge variant="outline" className="text-[11px]">{runs.length} runs</Badge>
        <Button variant="ghost" size="sm" className="ml-auto" onClick={() => void load()}>
          {loading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4" />
          )}
        </Button>
      </div>

      {!runs.length && !loading && (
        <p className="mt-3 rounded-lg border border-border/60 bg-muted/20 p-3 text-xs text-muted-foreground">
          No syncs recorded yet. Every run logs who started it, which activations it covered, and
          the resulting coverage.
        </p>
      )}

      <div className="mt-3 space-y-2">
        {byActivation.map(([activationId, list]) => {
          const latest = list[0];
          const expanded = open === activationId;
          const pct = Math.max(0, Math.min(100, Number(latest.coverage_pct ?? 0)));
          return (
            <div key={activationId} className="rounded-lg border border-border/60 bg-muted/20 p-3">
              <button
                type="button"
                className="flex w-full flex-wrap items-center gap-2 text-left"
                onClick={() => setOpen(expanded ? null : activationId)}
                aria-expanded={expanded}
              >
                {expanded ? (
                  <ChevronDown className="h-4 w-4 text-muted-foreground" />
                ) : (
                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                )}
                <Badge variant="secondary" className="text-[10px]">#{activationId}</Badge>
                <Badge variant="outline" className={`text-[10px] ${statusTone(latest.status)}`}>
                  {latest.status}
                </Badge>
                <span className="text-xs text-muted-foreground">
                  {new Date(latest.started_at).toLocaleString()}
                </span>
                <span className="ml-auto text-xs">
                  <span className="font-medium text-foreground">{latest.rows_scored}</span>
                  <span className="text-muted-foreground"> scored / {latest.rows_synced} synced</span>
                  {latest.rows_failed > 0 && (
                    <span className="text-destructive"> · {latest.rows_failed} failed</span>
                  )}
                </span>
              </button>

              <div className="mt-2 flex items-center gap-2">
                <Progress value={pct} className="h-1.5" />
                <span className="w-14 text-right text-[11px] text-muted-foreground">
                  {pct.toFixed(0)}%
                </span>
              </div>

              {latest.error && (
                <p className="mt-2 flex items-start gap-1.5 break-words rounded-md border border-destructive/30 bg-destructive/10 p-2 text-[11px] text-destructive">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  {latest.error}
                </p>
              )}

              {expanded && (
                <div className="mt-3 space-y-1.5 border-t border-border/60 pt-2">
                  {list.map((r) => (
                    <div
                      key={r.id}
                      className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground"
                    >
                      <span className="font-mono">{new Date(r.started_at).toLocaleString()}</span>
                      <Badge variant="outline" className={`text-[10px] ${statusTone(r.status)}`}>
                        {r.status}
                      </Badge>
                      <span>
                        {r.profiles_found} profiles · {r.rows_synced} synced · {r.rows_scored} scored
                        {r.rows_failed > 0 ? ` · ${r.rows_failed} failed` : ""}
                      </span>
                      <span>
                        {r.finished_at
                          ? `${Math.max(
                              0,
                              Math.round(
                                (new Date(r.finished_at).getTime() -
                                  new Date(r.started_at).getTime()) / 1000,
                              ),
                            )}s`
                          : "in progress"}
                      </span>
                      {r.started_by && (
                        <span className="font-mono opacity-70">by {r.started_by.slice(0, 8)}</span>
                      )}
                      {r.error && <span className="text-destructive">{r.error}</span>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </Card>
  );
};

export default IntuiziSyncStatusPanel;
