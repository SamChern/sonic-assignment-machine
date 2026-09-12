/**
 * How far the devices in each shared feed have travelled: landed, scored,
 * linked to audio, and carrying audio-grounded labels.
 */
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader2, RefreshCw } from "lucide-react";
import useEnterprisePipeline, {
  type FeedStages,
} from "@/components/admin/enterprise/useEnterprisePipeline";

const fmt = (n: number | null | undefined) => Math.round(n ?? 0).toLocaleString();

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
        aria-label={`${name}: ${pct}% of devices that landed`}
      >
        <div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
      </div>
      <p className="mt-1 text-[11px] text-muted-foreground">
        {pct}% of landed{hint ? ` · ${hint}` : ""}
      </p>
    </div>
  );
};

const FeedRow = ({ feed }: { feed: FeedStages }) => (
  <div className="rounded-lg border border-border/60 p-3">
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-sm font-medium">Feed #{feed.activation_id}</span>
      {feed.label && <span className="text-xs text-muted-foreground">{feed.label}</span>}
      <Badge variant={feed.is_active ? "secondary" : "outline"} className="text-[10px]">
        {feed.is_active ? "active" : "paused"}
      </Badge>
    </div>
    <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
      <Stage name="Landed" value={feed.raw} of={feed.raw} />
      <Stage name="Scored" value={feed.scored} of={feed.raw} />
      <Stage
        name="Linked to audio"
        value={feed.enriched_est}
        of={feed.raw}
        hint={`${feed.enriched_pct}% of the sample`}
      />
      <Stage
        name="Audio-labelled"
        value={feed.tagged_est}
        of={feed.raw}
        hint={`${feed.tagged_pct}% of the sample`}
      />
    </div>
  </div>
);

export const PipelinePanel = ({
  organizationId,
  orgName,
}: {
  organizationId: string;
  orgName: string;
}) => {
  const { report, loading, error, reload } = useEnterprisePipeline(organizationId);
  const feeds = report?.feeds ?? [];

  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-semibold">How {orgName}'s devices move through the pipeline</p>
          <p className="text-xs text-muted-foreground">
            Landed and scored are exact counts. Linked to audio and audio-labelled are estimated from
            a sample of {fmt(report?.sample_size ?? 1000)} scored devices per feed.
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
        {loading && !feeds.length && (
          <p className="text-sm text-muted-foreground">Counting devices…</p>
        )}
        {!loading && !feeds.length && !error && (
          <p className="text-sm text-muted-foreground">
            No data feeds are shared with this account yet.
          </p>
        )}
        {feeds.map((f) => (
          <FeedRow key={f.activation_id} feed={f} />
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
