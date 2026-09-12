import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Gauge, Loader2, PlayCircle, RefreshCw } from "lucide-react";
import { useOwnDataScoring } from "@/hooks/useOwnDataScoring";

const fmt = (n: number) => Number(n ?? 0).toLocaleString();
const pct = (v: number | null | undefined) =>
  v === null || v === undefined ? "—" : `${Math.round(Number(v) * 100)}%`;

/**
 * Confidence and coverage for the account's OWN rows — the numbers here are
 * computed from this account's datasets only, never from the platform-wide
 * population, and the button scores whatever is still waiting.
 */
export default function OwnDataScoringPanel({
  organizationId,
  canWrite,
}: {
  organizationId: string;
  canWrite: boolean;
}) {
  const { summary, loading, running, error, runNote, load, runScoring } =
    useOwnDataScoring(organizationId);

  const totals = summary?.totals;
  const coverage =
    totals && totals.rows_total > 0
      ? Math.round((totals.rows_scored / totals.rows_total) * 100)
      : 0;

  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-center gap-2">
        <p className="flex items-center gap-2 text-sm font-semibold">
          <Gauge className="h-4 w-4 text-primary" />
          Confidence from your own data
        </p>
        {totals && (
          <Badge variant="outline" className="text-[11px]">
            {fmt(totals.rows_total)} of your rows
          </Badge>
        )}
        <div className="ml-auto flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
            {loading ? (
              <Loader2 className="mr-1 h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="mr-1 h-4 w-4" />
            )}
            Refresh
          </Button>
          {canWrite && (
            <Button size="sm" onClick={() => void runScoring()} disabled={running}>
              {running ? (
                <Loader2 className="mr-1 h-4 w-4 animate-spin" />
              ) : (
                <PlayCircle className="mr-1 h-4 w-4" />
              )}
              Score waiting rows
            </Button>
          )}
        </div>
      </div>

      <p className="mt-1 text-xs text-muted-foreground">
        These figures come only from the rows in your own datasets. Scoring also runs on its own in
        the background, so this fills in without you starting it.
      </p>

      {error && (
        <p className="mt-3 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-xs">
          {error}
        </p>
      )}
      {runNote && !error && (
        <p className="mt-3 rounded-lg border border-border/60 bg-muted/20 p-3 text-xs">{runNote}</p>
      )}

      {totals && (
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <div className="rounded-lg border border-border/60 bg-muted/20 p-3">
            <p className="text-xs text-muted-foreground">Scored</p>
            <p className="text-2xl font-semibold">{fmt(totals.rows_scored)}</p>
            <Progress className="mt-2 h-1.5" value={coverage} />
            <p className="mt-1 text-[11px] text-muted-foreground">{coverage}% of your rows</p>
          </div>
          <div className="rounded-lg border border-border/60 bg-muted/20 p-3">
            <p className="text-xs text-muted-foreground">Waiting</p>
            <p className="text-2xl font-semibold">{fmt(totals.rows_pending)}</p>
            <p className="mt-1 text-[11px] text-muted-foreground">
              {totals.rows_unresolved
                ? `${fmt(totals.rows_unresolved)} need audio evidence`
                : "nothing blocked"}
            </p>
          </div>
          <div className="rounded-lg border border-border/60 bg-muted/20 p-3">
            <p className="text-xs text-muted-foreground">Average confidence</p>
            <p className="text-2xl font-semibold">{pct(totals.avg_confidence)}</p>
            <p className="mt-1 text-[11px] text-muted-foreground">
              across your scored rows
            </p>
          </div>
        </div>
      )}

      {summary?.datasets?.length ? (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[520px] text-xs">
            <thead>
              <tr className="text-left text-muted-foreground">
                <th className="py-1.5 pr-3 font-medium">Dataset</th>
                <th className="py-1.5 pr-3 font-medium">Rows</th>
                <th className="py-1.5 pr-3 font-medium">Scored</th>
                <th className="py-1.5 pr-3 font-medium">Waiting</th>
                <th className="py-1.5 pr-3 font-medium">Confidence</th>
              </tr>
            </thead>
            <tbody>
              {summary.datasets.map((d) => (
                <tr key={d.dataset_id} className="border-t border-border/50">
                  <td className="py-1.5 pr-3">{d.name ?? "Untitled"}</td>
                  <td className="py-1.5 pr-3">{fmt(d.rows_total)}</td>
                  <td className="py-1.5 pr-3">{fmt(d.rows_scored)}</td>
                  <td className="py-1.5 pr-3">{fmt(d.rows_pending)}</td>
                  <td className="py-1.5 pr-3">{pct(d.avg_confidence)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {summary?.last_run && (
        <p className="mt-3 text-[11px] text-muted-foreground">
          Last run {summary.last_run.trigger_source === "scheduled" ? "(automatic)" : "(started here)"}
          : {summary.last_run.status}, {fmt(summary.last_run.scored)} scored
          {summary.last_run.unresolved
            ? `, ${fmt(summary.last_run.unresolved)} unresolved`
            : ""}{" "}
          · {new Date(summary.last_run.started_at).toLocaleString()}
          {summary.last_run.error ? ` · ${summary.last_run.error}` : ""}
        </p>
      )}

      {!loading && totals && totals.rows_total === 0 && (
        <p className="mt-3 rounded-lg border border-border/60 bg-muted/20 p-3 text-xs text-muted-foreground">
          No rows of your own yet. Upload a file or sync a feed in My data, and scoring starts from
          there.
        </p>
      )}
    </Card>
  );
}
