/**
 * Dataset-by-dataset view of an enterprise account's scoring: progress,
 * audio-grounded rows, confidence and the last scoring run.
 */
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Loader2, RefreshCw } from "lucide-react";
import useScoringProgress, {
  type DatasetProgress,
} from "@/components/admin/enterprise/useScoringProgress";

const fmt = (n: number | null | undefined) => Math.round(n ?? 0).toLocaleString();

const pctOf = (part: number, total: number) =>
  total > 0 ? Math.min(100, Math.round((part / total) * 100)) : 0;

const Metric = ({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) => (
  <div className="rounded-lg border border-border/60 bg-muted/20 p-3">
    <p className="text-xs text-muted-foreground">{label}</p>
    <p className="text-lg font-semibold">{value}</p>
    {hint && <p className="mt-1 text-[11px] text-muted-foreground">{hint}</p>}
  </div>
);

const DatasetCard = ({ ds }: { ds: DatasetProgress }) => {
  const scoredPct = pctOf(ds.scored, ds.rows);
  const run = ds.last_run;
  return (
    <div className="rounded-lg border border-border/60 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium">{ds.name}</span>
        {ds.source_kind && (
          <span className="text-xs text-muted-foreground">{ds.source_kind}</span>
        )}
        {ds.status && (
          <Badge variant="outline" className="text-[10px]">
            {ds.status}
          </Badge>
        )}
        {ds.shared && (
          <Badge variant="secondary" className="text-[10px]">
            shared
          </Badge>
        )}
      </div>

      <div className="mt-3">
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>
            {fmt(ds.scored)} of {fmt(ds.rows)} rows scored
          </span>
          <span>{scoredPct}%</span>
        </div>
        <Progress value={scoredPct} className="mt-1 h-1.5" />
      </div>

      <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <Metric
          label="Awaiting a match"
          value={fmt(ds.unresolved + ds.pending)}
          hint={`${fmt(ds.unresolved)} with no match yet`}
        />
        <Metric
          label="Average confidence"
          value={ds.avg_confidence != null ? `${Math.round(ds.avg_confidence * 100)}%` : "—"}
          hint="Across every scored row"
        />
        <Metric
          label="Audio-grounded rows"
          value={fmt(ds.grounded_est)}
          hint={`${ds.grounded_pct}% of a ${fmt(ds.sampled)}-row sample${
            ds.bridged ? ` · ${fmt(ds.bridged)} carried over` : ""
          }`}
        />
        <Metric
          label="Rows with audio evidence"
          value={fmt(ds.audio_evidence_est)}
          hint={`${ds.audio_pct}% of the sample has a linked recording`}
        />
      </div>

      {run && (
        <p className="mt-2 text-xs text-muted-foreground">
          Last run {run.status ?? "unknown"}
          {run.started_at ? ` · started ${new Date(run.started_at).toLocaleString()}` : ""}
          {run.scored != null ? ` · ${fmt(run.scored)} scored` : ""}
          {run.unresolved != null ? ` · ${fmt(run.unresolved)} unresolved` : ""}
          {run.avg_confidence != null
            ? ` · ${Math.round(run.avg_confidence * 100)}% confidence`
            : ""}
          {run.trigger_source ? ` · via ${run.trigger_source}` : ""}
        </p>
      )}
      {run?.error && <p className="mt-1 text-xs text-destructive">{run.error}</p>}
    </div>
  );
};

export const ScoringProgressPanel = ({
  organizationId,
  orgName,
}: {
  organizationId: string;
  orgName: string;
}) => {
  const { report, loading, error, reload } = useScoringProgress(organizationId);
  const datasets = report?.datasets ?? [];

  const totals = datasets.reduce(
    (acc, d) => {
      acc.rows += d.rows;
      acc.scored += d.scored;
      acc.grounded += d.grounded_est;
      acc.audio += d.audio_evidence_est;
      if (d.avg_confidence != null && d.scored > 0) {
        acc.confWeight += d.scored;
        acc.confSum += d.avg_confidence * d.scored;
      }
      return acc;
    },
    { rows: 0, scored: 0, grounded: 0, audio: 0, confSum: 0, confWeight: 0 },
  );
  const avgConfidence = totals.confWeight > 0 ? totals.confSum / totals.confWeight : null;

  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-semibold">{orgName}: scoring progress by dataset</p>
          <p className="text-xs text-muted-foreground">
            Row and confidence figures are exact. Audio-grounded and audio-evidence counts are
            estimated from a sample of {fmt(report?.sample_size ?? 600)} recent rows per dataset.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void reload()} disabled={loading}>
          {loading ? (
            <Loader2 aria-hidden="true" className="mr-1 h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw aria-hidden="true" className="mr-1 h-4 w-4" />
          )}
          Refresh
        </Button>
      </div>

      {error && <p className="mt-2 text-xs text-destructive">{error}</p>}

      {datasets.length > 0 && (
        <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <Metric label="Rows in total" value={fmt(totals.rows)} />
          <Metric
            label="Scored"
            value={fmt(totals.scored)}
            hint={`${pctOf(totals.scored, totals.rows)}% of all rows`}
          />
          <Metric
            label="Audio-grounded"
            value={fmt(totals.grounded)}
            hint="Estimated across datasets"
          />
          <Metric
            label="Confidence"
            value={avgConfidence != null ? `${Math.round(avgConfidence * 100)}%` : "—"}
            hint="Weighted by scored rows"
          />
        </div>
      )}

      <div className="mt-3 space-y-3">
        {loading && !datasets.length && (
          <p className="text-sm text-muted-foreground">Reading the datasets…</p>
        )}
        {!loading && !datasets.length && !error && (
          <p className="text-sm text-muted-foreground">
            This account has no datasets yet, so there is nothing to score.
          </p>
        )}
        {datasets.map((ds) => (
          <DatasetCard key={ds.dataset_id} ds={ds} />
        ))}
      </div>

      {report?.computed_at && (
        <p className="mt-2 text-xs text-muted-foreground">
          Counted {new Date(report.computed_at).toLocaleTimeString()}
        </p>
      )}
    </Card>
  );
};

export default ScoringProgressPanel;
