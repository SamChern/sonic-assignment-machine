/**
 * Live dashboard of Intuizi scoring runs: what is waiting, what is running
 * right now, and what has just finished. Auto-refreshes on a bounded poll.
 */
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Cpu,
  Loader2,
  PauseCircle,
  Play,
  RefreshCw,
  RotateCcw,
  Skull,

} from "lucide-react";
import { useScoringRuns, type QueueItem } from "./useScoringRuns";

const STATUS_STYLE: Record<string, string> = {
  pending: "bg-sky-500/15 text-sky-400 border-sky-500/30",
  processing: "bg-primary/15 text-primary border-primary/30",
  done: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  skipped: "bg-muted text-muted-foreground border-border",
  failed: "bg-amber-500/15 text-amber-400 border-amber-500/30",
  dead_letter: "bg-destructive/15 text-destructive border-destructive/30",
};

const fmt = (n: number) => n.toLocaleString();
const ago = (iso: string) => {
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
};

const Stat = ({
  icon,
  label,
  value,
  hint,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  hint?: string;
  tone?: string;
}) => (
  <div className="rounded-lg border border-border bg-card/60 p-3">
    <div className="flex items-center gap-2 text-xs text-muted-foreground">
      <span aria-hidden="true">{icon}</span>
      {label}
    </div>
    <p className={`mt-1 text-2xl font-semibold tabular-nums ${tone ?? ""}`}>{value}</p>
    {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
  </div>
);

const ItemRow = ({ item }: { item: QueueItem }) => (
  <li className="flex flex-wrap items-center gap-2 border-b border-border/60 py-2 last:border-0 text-xs">
    <Badge variant="outline" className={STATUS_STYLE[item.status] ?? ""}>
      {item.status.replace("_", " ")}
    </Badge>
    <span className="font-mono truncate max-w-[14rem]" title={item.identifier}>
      {item.identifier}
    </span>
    {item.activation_id && (
      <span className="text-muted-foreground">activation {item.activation_id}</span>
    )}
    {item.last_stage && <span className="text-muted-foreground">· {item.last_stage}</span>}
    {item.attempts > 1 && (
      <span className="text-muted-foreground">· attempt {item.attempts}</span>
    )}
    <span className="ml-auto text-muted-foreground whitespace-nowrap">
      {ago(item.updated_at)}
    </span>
    {item.last_error && (
      <span className="w-full text-[11px] text-destructive truncate" title={item.last_error}>
        {item.last_error}
      </span>
    )}
  </li>
);

export const ScoringRunsDashboard = () => {
  const s = useScoringRuns();
  const capped = s.depth ? s.depth.pending_capped >= s.depth.capped_at : false;
  const doneTotal = s.activations.reduce((a, r) => a + r.done_rows, 0);

  return (
    <Card className="p-5 space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <Activity className="h-5 w-5 text-primary" aria-hidden="true" />
        <h2 className="text-base font-semibold">Scoring runs</h2>
        {s.paused ? (
          <Badge variant="destructive" className="gap-1 text-[11px]">
            <PauseCircle className="h-3 w-3" aria-hidden="true" /> paused
          </Badge>
        ) : s.running.length ? (
          <Badge className="gap-1 text-[11px]">
            <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" /> running
          </Badge>
        ) : (
          <Badge variant="outline" className="text-[11px]">idle</Badge>
        )}
        <div className="ml-auto flex items-center gap-3">
          <div className="flex items-center gap-2">
            <Switch id="scoring-live" checked={s.live} onCheckedChange={s.setLive} />
            <Label htmlFor="scoring-live" className="text-xs text-muted-foreground">
              Live
            </Label>
          </div>
          <Button variant="outline" size="sm" onClick={s.reload} disabled={s.loading}>
            <RefreshCw
              className={`mr-1 h-4 w-4 ${s.loading ? "animate-spin" : ""}`}
              aria-hidden="true"
            />
            Refresh
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={() => s.start()} disabled={!!s.busy || s.paused}>
          {s.busy === "start" ? (
            <Loader2 className="mr-1 h-4 w-4 animate-spin" aria-hidden="true" />
          ) : (
            <Play className="mr-1 h-4 w-4" aria-hidden="true" />
          )}
          Run scoring now
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => s.requeueFailed()}
          disabled={!!s.busy}
        >
          {s.busy === "requeue" ? (
            <Loader2 className="mr-1 h-4 w-4 animate-spin" aria-hidden="true" />
          ) : (
            <RotateCcw className="mr-1 h-4 w-4" aria-hidden="true" />
          )}
          Retry failed items
        </Button>
        <Button
          size="sm"
          variant={s.paused ? "default" : "ghost"}
          onClick={() => s.setPaused(!s.paused)}
          disabled={!!s.busy}
        >
          {s.busy === "pause" || s.busy === "resume" ? (
            <Loader2 className="mr-1 h-4 w-4 animate-spin" aria-hidden="true" />
          ) : s.paused ? (
            <Play className="mr-1 h-4 w-4" aria-hidden="true" />
          ) : (
            <PauseCircle className="mr-1 h-4 w-4" aria-hidden="true" />
          )}
          {s.paused ? "Resume scoring" : "Pause scoring"}
        </Button>
        {s.lastRun && <span className="text-xs text-muted-foreground">{s.lastRun}</span>}
      </div>

      {s.paused && (
        <p className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-xs text-destructive">
          Scoring is paused{s.pauseReason ? `: ${s.pauseReason}` : ""}. Nothing will move until it
          resumes.
        </p>
      )}

      {s.error && (
        <p className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-xs text-amber-500">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          {s.error}
        </p>
      )}


      <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
        <Stat
          icon={<Clock className="h-3.5 w-3.5" />}
          label="Waiting"
          value={s.depth ? `${capped ? "≥" : ""}${fmt(s.depth.pending_capped)}` : "—"}
          hint={capped ? `counted up to ${fmt(s.depth?.capped_at ?? 0)}` : undefined}
        />
        <Stat
          icon={<Loader2 className="h-3.5 w-3.5" />}
          label="Running now"
          value={fmt(s.running.length)}
          hint={s.running.length >= 50 ? "showing newest 50" : undefined}
          tone="text-primary"
        />
        <Stat
          icon={<CheckCircle2 className="h-3.5 w-3.5" />}
          label="Completed"
          value={fmt(doneTotal)}
          hint="across tracked activations"
          tone="text-emerald-400"
        />
        <Stat
          icon={<Skull className="h-3.5 w-3.5" />}
          label="Dead letter"
          value={s.depth ? fmt(s.depth.dead_letter_capped) : "—"}
          tone={s.depth?.dead_letter_capped ? "text-destructive" : undefined}
        />
      </div>

      <div>
        <h3 className="mb-2 text-sm font-medium">Activations</h3>
        {s.activations.length === 0 ? (
          <p className="text-xs text-muted-foreground">No activation snapshots yet.</p>
        ) : (
          <ul className="space-y-3">
            {s.activations.map((a) => {
              const pct = a.total_rows ? Math.round((a.done_rows / a.total_rows) * 100) : 0;
              return (
                <li key={a.activation_id} className="space-y-1">
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <span className="font-medium">Activation {a.activation_id}</span>
                    <span className="text-muted-foreground">
                      {fmt(a.done_rows)} of {fmt(a.total_rows)} scored · {fmt(a.pending_rows)} waiting
                    </span>
                    <span className="ml-auto text-muted-foreground">
                      updated {ago(a.computed_at)}
                    </span>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-6 px-2 text-[11px]"
                      onClick={() => s.start(a.activation_id)}
                      disabled={!!s.busy || s.paused}
                    >
                      Score this one
                    </Button>

                  </div>
                  <Progress value={pct} aria-label={`Activation ${a.activation_id} progress`} />
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <div>
          <h3 className="mb-1 text-sm font-medium">In flight</h3>
          {s.running.length === 0 ? (
            <p className="text-xs text-muted-foreground">Nothing is being scored right now.</p>
          ) : (
            <ul className="max-h-72 overflow-y-auto pr-1">
              {s.running.map((r) => (
                <ItemRow key={r.id} item={r} />
              ))}
            </ul>
          )}
        </div>
        <div>
          <h3 className="mb-1 text-sm font-medium">Just finished</h3>
          {s.recent.length === 0 ? (
            <p className="text-xs text-muted-foreground">No completed runs yet.</p>
          ) : (
            <ul className="max-h-72 overflow-y-auto pr-1">
              {s.recent.map((r) => (
                <ItemRow key={r.id} item={r} />
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3 text-[11px] text-muted-foreground">
        <Cpu className="h-3.5 w-3.5" aria-hidden="true" />
        {s.workers.length === 0 ? (
          <span>No scoring worker has checked in.</span>
        ) : (
          s.workers.map((w) => (
            <span key={w.worker_id} className="rounded border border-border px-2 py-0.5">
              {w.worker_id}
              {w.host ? ` · ${w.host}` : ""} · {ago(w.last_seen)}
            </span>
          ))
        )}
        {s.fetchedAt && <span className="ml-auto">refreshed {ago(s.fetchedAt.toISOString())}</span>}
      </div>
    </Card>
  );
};

export default ScoringRunsDashboard;
