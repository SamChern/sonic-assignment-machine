import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Activity, Loader2, RefreshCw } from "lucide-react";

/**
 * Step 2.5-alt worker health. Replaces the old SQS status block: in queue-free
 * mode the thing to watch is whether the EC2 worker is alive and whether the
 * waiting list is draining.
 */

/** A heartbeat older than this means the worker is not running. */
const STALE_MS = 5 * 60 * 1000;

interface Beat {
  worker_id: string;
  host: string | null;
  last_seen: string;
  stats: unknown;
}

const relative = (iso: string | null) => {
  if (!iso) return "never";
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 48) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
};

const statOf = (stats: unknown, key: string): string => {
  if (!stats || typeof stats !== "object") return "—";
  const v = (stats as Record<string, unknown>)[key];
  return v === undefined || v === null ? "—" : String(v);
};

/** One ledger row, as shown in the per-file list. */
interface LedgerRow {
  id: string;
  object_key: string;
  status: string;
  worker_id: string | null;
  heartbeat_at: string | null;
  rows_offset: number | null;
  total_rows: number | null;
  retryable_stops: number | null;
}

const WorkerHealthCard = () => {
  const [beats, setBeats] = useState<Beat[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [files, setFiles] = useState<LedgerRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const [beatRes, fileRes] = await Promise.all([
      supabase
        .from("worker_heartbeats")
        .select("worker_id, host, last_seen, stats")
        .order("last_seen", { ascending: false })
        .limit(10),
      supabase
        .from("intuizi_ingest_files")
        .select(
          "id, object_key, status, worker_id, heartbeat_at, rows_offset, total_rows, retryable_stops",
        )
        .in("status", [
          "discovered",
          "processing",
          "partial",
          "loaded",
          "failed",
          "skipped",
          "blocked",
        ])
        .order("updated_at", { ascending: false })
        .limit(1000),
    ]);
    setBeats((beatRes.data as Beat[]) ?? []);
    const rows = ((fileRes.data ?? []) as LedgerRow[]);
    const tally: Record<string, number> = {};
    for (const row of rows) tally[row.status] = (tally[row.status] ?? 0) + 1;
    setCounts(tally);
    // Only the rows an operator acts on: in flight, waiting, or parked.
    setFiles(
      rows
        .filter((r) => r.status !== "loaded" && r.status !== "skipped")
        .slice(0, 12),
    );
    setLoading(false);
  }, []);


  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 60_000);
    return () => clearInterval(t);
  }, [load]);

  const live = beats.filter((b) => Date.now() - new Date(b.last_seen).getTime() < STALE_MS);
  const waiting = counts.discovered ?? 0;

  return (
    <Card className="p-5 space-y-4 bg-card/60 border-border">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <Activity className="h-4 w-4 text-primary" />
          <div>
            <h2 className="font-semibold">Ingest worker health</h2>
            <p className="text-sm text-muted-foreground">
              Queue-free mode — the EC2 worker claims discovered files over HTTPS
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant={live.length ? "default" : "destructive"} className="text-xs">
            {live.length ? `${live.length} worker${live.length === 1 ? "" : "s"} live` : "no worker"}
          </Badge>
          <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
            {loading ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <RefreshCw className="h-3 w-3" />
            )}
          </Button>
        </div>
      </div>

      <div className="rounded-md border border-border bg-muted/30 p-3 flex flex-wrap gap-x-6 gap-y-2">
        {[
          { label: "Waiting", value: String(waiting) },
          { label: "Processing", value: String(counts.processing ?? 0) },
          { label: "Loaded", value: String(counts.loaded ?? 0) },
          { label: "Skipped", value: String(counts.skipped ?? 0) },
          { label: "Failed", value: String(counts.failed ?? 0) },
        ].map((m) => (
          <div key={m.label}>
            <p className="text-xs text-muted-foreground">{m.label}</p>
            <p className="text-sm font-medium">{m.value}</p>
          </div>
        ))}
      </div>

      {beats.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          No worker has ever checked in. Install the ingest worker on the EC2 box — until then
          discovered files stay in the waiting list.
        </p>
      ) : (
        <div className="space-y-2">
          {beats.map((b) => {
            const stale = Date.now() - new Date(b.last_seen).getTime() >= STALE_MS;
            return (
              <div
                key={b.worker_id}
                className="rounded-md border border-border bg-muted/20 p-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs"
              >
                <span className="font-mono text-foreground">{b.worker_id}</span>
                {b.host && <span className="text-muted-foreground">host {b.host}</span>}
                <span className={stale ? "text-destructive" : "text-muted-foreground"}>
                  heartbeat {relative(b.last_seen)}
                </span>
                <span className="text-muted-foreground">
                  files done {statOf(b.stats, "files_done")}
                </span>
                <span className="text-muted-foreground">
                  poll {statOf(b.stats, "poll_seconds")}s
                </span>
                {stale && (
                  <Badge variant="destructive" className="text-[10px]">
                    stale
                  </Badge>
                )}
              </div>
            );
          })}
        </div>
      )}

      {waiting > 0 && live.length === 0 && (
        <p className="text-xs text-destructive">
          {waiting} file{waiting === 1 ? "" : "s"} waiting with no live worker — start the
          ingest-worker service on EC2.
        </p>
      )}
    </Card>
  );
};

export default WorkerHealthCard;
