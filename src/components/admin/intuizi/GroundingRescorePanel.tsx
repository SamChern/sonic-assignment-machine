/**
 * Admin panel: full re-score of audiences still scored without audio evidence.
 */
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { RefreshCw, Play, Pause, RotateCcw } from "lucide-react";
import useGroundingRescore from "@/components/admin/intuizi/useGroundingRescore";

const fmt = (n: number | null | undefined) => (n ?? 0).toLocaleString();

export const GroundingRescorePanel = () => {
  const { status, loading, busy, error, note, load, control, runBatch } = useGroundingRescore();
  const sweep = status?.sweep ?? null;
  const active = sweep?.status === "running" || sweep?.status === "paused";

  return (
    <Card className="p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-medium">Re-score audiences without audio evidence</h3>
          <p className="text-xs text-muted-foreground">
            Walks every audience that has a listened-to audio vector but is still scored from labels
            alone, and re-scores it against its closest audio-grounded neighbours. No AI credits are
            used, and the sweep resumes on its own as new grounded audio lands.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={() => void load()} disabled={loading || busy}>
            <RefreshCw aria-hidden="true" className="mr-1 h-4 w-4" /> Refresh
          </Button>
          {sweep?.status === "running" ? (
            <Button size="sm" variant="outline" onClick={() => void control("pause")} disabled={busy}>
              <Pause aria-hidden="true" className="mr-1 h-4 w-4" /> Pause
            </Button>
          ) : (
            <Button size="sm" onClick={() => void control("start")} disabled={busy}>
              <Play aria-hidden="true" className="mr-1 h-4 w-4" />
              {sweep?.status === "paused" ? "Resume" : "Start sweep"}
            </Button>
          )}
          <Button size="sm" variant="outline" onClick={() => void control("restart")} disabled={busy}>
            <RotateCcw aria-hidden="true" className="mr-1 h-4 w-4" /> Start over
          </Button>
          <Button size="sm" variant="secondary" onClick={() => void runBatch()} disabled={busy || !active}>
            Run a batch now
          </Button>
        </div>
      </div>

      {error && <p className="mb-2 text-xs text-destructive">{error}</p>}
      {note && <p className="mb-2 text-xs text-muted-foreground">{note}</p>}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-md border p-3">
          <p className="text-xs text-muted-foreground">Sweep state</p>
          <Badge variant={sweep?.status === "running" ? "default" : "secondary"} className="mt-1">
            {sweep?.status ?? "not started"}
          </Badge>
        </div>
        <div className="rounded-md border p-3">
          <p className="text-xs text-muted-foreground">Re-scored with audio</p>
          <p className="text-lg font-semibold">{fmt(sweep?.upgraded)}</p>
        </div>
        <div className="rounded-md border p-3">
          <p className="text-xs text-muted-foreground">Checked so far</p>
          <p className="text-lg font-semibold">{fmt(sweep?.scanned)}</p>
          <p className="text-xs text-muted-foreground">{fmt(sweep?.skipped)} had no close match</p>
        </div>
        <div className="rounded-md border p-3">
          <p className="text-xs text-muted-foreground">Still waiting</p>
          <p className="text-lg font-semibold">{fmt(status?.text_only_with_vector)}</p>
          <p className="text-xs text-muted-foreground">
            of {fmt(status?.sources_with_vector)} audiences with audio
          </p>
        </div>
      </div>

      {sweep?.note && <p className="mt-2 text-xs text-muted-foreground">{sweep.note}</p>}
      {status?.computed_at && (
        <p className="mt-2 text-xs text-muted-foreground">
          Checked {new Date(status.computed_at).toLocaleTimeString()}
        </p>
      )}
    </Card>
  );
};

export default GroundingRescorePanel;
