/**
 * Scoring queue health + dead-letter recovery.
 *
 * Background scoring is decoupled from ingest, so failures used to be invisible.
 * This panel surfaces the queue by status (including the dead-letter state that
 * catches identifiers which failed repeatedly), groups failures by classified
 * cause and stage, and offers a one-click re-enqueue that resumes only the
 * failed identifiers — completed scoring is never redone because scoring is
 * idempotent per identifier.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AlertTriangle, Loader2, RefreshCw, RotateCcw, Skull } from "lucide-react";

interface QueueRow {
  id: string;
  identifier: string;
  object_key: string;
  activation_id: string | null;
  status: string;
  attempts: number;
  max_attempts: number;
  failure_kind: string | null;
  last_stage: string | null;
  last_error: string | null;
  trace_id: string | null;
  step_scale: number | null;
  next_attempt_at: string | null;
}

interface Props {
  /** Limit the view + recovery action to one activation. */
  activationId?: string;
  /** Limit the view + recovery action to one delivered object. */
  objectKey?: string;
  className?: string;
}

const STATUS_STYLES: Record<string, string> = {
  pending: "bg-sky-500/15 text-sky-300 border-sky-500/30",
  processing: "bg-primary/15 text-primary border-primary/30",
  done: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  skipped: "bg-muted text-muted-foreground border-border",
  failed: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  dead_letter: "bg-destructive/15 text-destructive border-destructive/30",
};

const KIND_HINTS: Record<string, string> = {
  credits: "AI credits unavailable — add credits, then re-enqueue.",
  policy: "Blocked by workspace policy — an admin must unblock AI usage.",
  auth: "Auth/configuration problem with the analysis service.",
  schema: "Permanent data/contract error — these fail fast and need a fix, not a retry.",
  resource: "Compute/timeout kill — retries automatically run with a smaller workload.",
  rate_limit: "Rate limited upstream — retries are scheduled with backoff.",
  transient: "Temporary upstream failure — safe to re-enqueue.",
  attempts_exhausted: "Attempt budget spent — inspect the last error before retrying.",
  unknown: "Unclassified failure — see the last error.",
};

const ScoreQueueHealthPanel = ({ activationId, objectKey, className }: Props) => {
  const [rows, setRows] = useState<QueueRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [requeuing, setRequeuing] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    let q = supabase
      .from("intuizi_score_queue")
      .select(
        "id,identifier,object_key,activation_id,status,attempts,max_attempts,failure_kind,last_stage,last_error,trace_id,step_scale,next_attempt_at",
      )
      .order("updated_at", { ascending: false })
      .limit(2000);
    if (activationId) q = q.eq("activation_id", activationId);
    if (objectKey) q = q.eq("object_key", objectKey);
    const { data, error } = await q;
    setLoading(false);
    if (error) {
      toast({ title: "Could not read the scoring queue", description: error.message, variant: "destructive" });
      return;
    }
    setRows((data ?? []) as QueueRow[]);
  }, [activationId, objectKey]);

  useEffect(() => {
    void load();
  }, [load]);

  const counts = useMemo(() => {
    const by: Record<string, number> = {};
    for (const r of rows) by[r.status] = (by[r.status] ?? 0) + 1;
    return by;
  }, [rows]);

  const broken = useMemo(
    () => rows.filter((r) => r.status === "failed" || r.status === "dead_letter"),
    [rows],
  );

  const byKind = useMemo(() => {
    const m = new Map<string, QueueRow[]>();
    for (const r of broken) {
      const k = r.failure_kind ?? "unknown";
      m.set(k, [...(m.get(k) ?? []), r]);
    }
    return [...m.entries()].sort((a, b) => b[1].length - a[1].length);
  }, [broken]);

  const requeue = useCallback(async () => {
    setRequeuing(true);
    const { data, error } = await supabase.functions.invoke("intuizi-score-worker", {
      body: {
        action: "requeue_failed",
        activation_id: activationId ?? null,
        object_key: objectKey ?? null,
        include_dead_letter: true,
      },
    });
    setRequeuing(false);
    if (error) {
      toast({ title: "Re-enqueue failed", description: error.message, variant: "destructive" });
      return;
    }
    const res = data as { requeued?: number; remaining_dead_letter?: number };
    toast({
      title: `${res?.requeued ?? 0} identifier(s) re-enqueued`,
      description:
        "Scoring resumes from the last successful stage — identifiers already scored are skipped.",
    });
    await load();
  }, [activationId, objectKey, load]);

  const total = rows.length;

  return (
    <Card className={className}>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <AlertTriangle className="h-4 w-4 text-amber-400" />
          Scoring queue health
        </CardTitle>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" className="h-8" onClick={() => void load()} disabled={loading}>
            {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            <span className="ml-1.5 text-xs">Refresh</span>
          </Button>
          <Button
            size="sm"
            className="h-8"
            onClick={() => void requeue()}
            disabled={requeuing || broken.length === 0}
          >
            {requeuing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}
            <span className="ml-1.5 text-xs">Re-enqueue failed ({broken.length})</span>
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {total === 0
          ? (
            <p className="text-sm text-muted-foreground">
              No scoring tasks{activationId ? ` for activation ${activationId}` : ""} yet.
            </p>
          )
          : (
            <>
              <div className="flex flex-wrap gap-2">
                {Object.entries(counts).map(([status, n]) => (
                  <Badge
                    key={status}
                    variant="outline"
                    className={STATUS_STYLES[status] ?? "border-border text-muted-foreground"}
                  >
                    {status === "dead_letter" && <Skull className="mr-1 h-3 w-3" />}
                    {status.replace("_", " ")} · {n}
                  </Badge>
                ))}
              </div>

              {byKind.length > 0 && (
                <div className="space-y-2">
                  {byKind.map(([kind, items]) => (
                    <div key={kind} className="rounded-lg border border-border/60 bg-muted/30 p-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-medium">{kind.replace("_", " ")}</span>
                        <Badge variant="secondary" className="text-[11px]">{items.length}</Badge>
                        <span className="text-[11px] text-muted-foreground">
                          {KIND_HINTS[kind] ?? KIND_HINTS.unknown}
                        </span>
                      </div>
                      <ul className="mt-2 space-y-1">
                        {items.slice(0, 4).map((r) => (
                          <li key={r.id} className="text-[11px] leading-snug text-muted-foreground">
                            <span className="font-mono text-foreground/80">{r.identifier.slice(0, 14)}</span>
                            {" · stage "}
                            <span className="text-foreground/80">{r.last_stage ?? "unknown"}</span>
                            {" · attempt "}
                            {r.attempts}/{r.max_attempts}
                            {r.step_scale && r.step_scale < 1 ? ` · step ×${r.step_scale}` : ""}
                            {r.trace_id ? <> · trace <span className="font-mono">{r.trace_id}</span></> : null}
                            {r.last_error ? ` — ${r.last_error.slice(0, 120)}` : ""}
                          </li>
                        ))}
                        {items.length > 4 && (
                          <li className="text-[11px] text-muted-foreground">
                            +{items.length - 4} more with the same cause
                          </li>
                        )}
                      </ul>
                    </div>
                  ))}
                </div>
              )}

              <p className="text-[11px] text-muted-foreground">
                Identifiers that fail repeatedly move to the dead-letter state instead of being
                retried forever or dropped. Re-enqueue is safe at any time: already-scored
                identifiers short-circuit, so only unfinished work runs again.
              </p>
            </>
          )}
      </CardContent>
    </Card>
  );
};

export default ScoreQueueHealthPanel;
