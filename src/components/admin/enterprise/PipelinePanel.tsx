/**
 * How far each dataset's rows have travelled: landed, scored, linked to audio,
 * and carrying audio-grounded labels — plus what is still waiting, so a slow
 * dataset is easy to spot.
 */
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader2, RefreshCw } from "lucide-react";
import useEnterprisePipeline, {
  type DatasetStages,
} from "@/components/admin/enterprise/useEnterprisePipeline";

const fmt = (n: number | null | undefined) => Math.round(n ?? 0).toLocaleString();

const waitLabel = (hours: number | null) => {
  if (hours === null || hours === undefined) return null;
  if (hours < 1) return "waiting under an hour";
  if (hours < 48) return `waiting ${Math.round(hours)}h`;
  return `waiting ${Math.round(hours / 24)}d`;
};

const Stage = ({
  name,
  value,
  of,
  hint,
}: {
  name: string;
  value: number;
  of: number;
  hint?: string;
}) => {
  const pct = of > 0 ? Math.min(100, Math.round((value / of) * 100)) : 0;
  return (
    <div className="rounded-lg border border-border/60 bg-muted/20 p-3">
      <p className="text-xs text-muted-foreground">{name}</p>
      <p className="text-lg font-semibold">{fmt(value)}</p>
      <div
        className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-muted"
        role="img"
        aria-label={`${name}: ${pct}% of rows that landed`}
      >
        <div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
      </div>
      <p className="mt-1 text-[11px] text-muted-foreground">
        {pct}% of landed{hint ? ` · ${hint}` : ""}
      </p>
    </div>
  );
};

const DatasetRow = ({ ds }: { ds: DatasetStages }) => {
  const wait = waitLabel(ds.pending_age_hours);
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
        {ds.pending > 0 && (
          <Badge variant="outline" className="text-[10px]">
            {fmt(ds.pending)} still to score{wait ? ` · ${wait}` : ""}
          </Badge>
        )}
        {ds.failed > 0 && (
          <Badge variant="destructive" className="text-[10px]">
            {fmt(ds.failed)} failed
          </Badge>
        )}
      </div>
      <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <Stage name="Landed" value={ds.raw} of={ds.raw} />
        <Stage name="Scored" value={ds.scored} of={ds.raw} />
        <Stage
          name="Linked to audio"
          value={ds.enriched_est}
          of={ds.raw}
          hint={`${ds.enriched_pct}% of the sample`}
        />
        <Stage
          name="Audio-labelled"
          value={ds.tagged_est}
          of={ds.raw}
          hint={`${ds.tagged_pct}% of the sample`}
        />
      </div>
      {ds.last_scored_at && (
        <p className="mt-2 text-[11px] text-muted-foreground">
          Last row scored {new Date(ds.last_scored_at).toLocaleString()}
        </p>
      )}
    </div>
  );
};

export const PipelinePanel = ({
  organizationId,
  orgName,
}: {
  organizationId: string;
  orgName: string;
}) => {
  const { report, loading, error, reload } = useEnterprisePipeline(organizationId);
  const datasets = report?.datasets ?? [];

  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-semibold">
            How {orgName}'s rows move through the pipeline, by dataset
          </p>
          <p className="text-xs text-muted-foreground">
            Landed, scored, waiting and failed are exact counts. Linked to audio and
            audio-labelled are estimated from a sample of {fmt(report?.sample_size ?? 1000)} scored
            rows per dataset.
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

      <div className="mt-3 space-y-3">
        {loading && !datasets.length && (
          <p className="text-sm text-muted-foreground">Counting rows…</p>
        )}
        {!loading && !datasets.length && !error && (
          <p className="text-sm text-muted-foreground">
            This account has no datasets yet.
          </p>
        )}
        {datasets.map((ds) => (
          <DatasetRow key={ds.dataset_id} ds={ds} />
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

export default PipelinePanel;
