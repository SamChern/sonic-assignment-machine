import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, RefreshCw, Sparkles, Layers, Gauge } from "lucide-react";

interface Grant {
  activation_id: string;
  label: string | null;
}

interface Summary {
  activation_id: string;
  rows_total: number;
  rows_scored: number;
  rows_waiting: number;
  rows_failed: number;
  coverage_pct: number;
  avg_confidence: number | null;
  signal_families: { family: string; rows: number }[];
  top_tags: { tag: string; rows: number }[];
  kpi_events: { event: string; events: number }[];
  sampled_rows: number;
  computed_at: string;
}

const fmt = (n: number) => n.toLocaleString();

/**
 * Read-only view of what SonicSIM adds to one granted data feed: how many
 * device-level rows already carry the six semantic scores, which signal
 * families the feed brings, and which of the account's own tracked events
 * those scores can be measured against.
 */
export default function EnrichmentPreviewPanel({
  organizationId,
}: {
  organizationId: string;
}) {
  const [grants, setGrants] = useState<Grant[]>([]);
  const [feed, setFeed] = useState<string>("");
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const { data, error: err } = await supabase
        .from("org_intuizi_activations")
        .select("activation_id, label")
        .eq("organization_id", organizationId)
        .eq("is_active", true)
        .order("activation_id");
      if (cancelled) return;
      if (err) setError(err.message);
      const rows = (data ?? []) as Grant[];
      setGrants(rows);
      setFeed((prev) => prev || rows[0]?.activation_id || "");
      if (!rows.length) setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [organizationId]);

  const load = useCallback(async () => {
    if (!feed) return;
    setLoading(true);
    setError(null);
    const { data, error: err } = await supabase.rpc("org_activation_enrichment", {
      _organization_id: organizationId,
      _activation_id: feed,
      _sample: 2000,
    });
    setLoading(false);
    if (err) {
      setError(err.message);
      setSummary(null);
      return;
    }
    setSummary(data as unknown as Summary);
  }, [organizationId, feed]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-center gap-2">
        <p className="flex items-center gap-2 text-sm font-semibold">
          <Sparkles className="h-4 w-4 text-primary" />
          What SonicSIM adds to this feed
        </p>
        {summary && (
          <Badge variant="outline" className="text-[11px]">
            {fmt(summary.rows_total)} device rows
          </Badge>
        )}
        <div className="ml-auto flex items-center gap-2">
          {grants.length > 1 && (
            <Select value={feed} onValueChange={setFeed}>
              <SelectTrigger className="h-9 w-[190px]">
                <SelectValue placeholder="Data feed" />
              </SelectTrigger>
              <SelectContent>
                {grants.map((g) => (
                  <SelectItem key={g.activation_id} value={g.activation_id}>
                    {g.label ? `${g.label} (#${g.activation_id})` : `Feed #${g.activation_id}`}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
            {loading ? (
              <Loader2 className="mr-1 h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="mr-1 h-4 w-4" />
            )}
            Refresh
          </Button>
        </div>
      </div>

      <p className="mt-1 text-xs text-muted-foreground">
        Every row is one device. SonicSIM appends the six semantic scores, audio grounding and
        sonic tags to each one, so you can relate them to the results you measure.
      </p>

      {!grants.length && !loading && (
        <p className="mt-3 rounded-lg border border-border/60 bg-muted/20 p-3 text-xs text-muted-foreground">
          No data feed has been shared with this account yet.
        </p>
      )}

      {error && (
        <p className="mt-3 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-xs">
          Couldn't load this feed: {error}
        </p>
      )}

      {summary && (
        <>
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            <div className="rounded-lg border border-border/60 bg-muted/20 p-3">
              <p className="text-xs text-muted-foreground">Enriched so far</p>
              <p className="text-2xl font-semibold">{fmt(summary.rows_scored)}</p>
              <Progress className="mt-2 h-1.5" value={summary.coverage_pct} />
              <p className="mt-1 text-[11px] text-muted-foreground">
                {summary.coverage_pct}% of the feed
              </p>
            </div>
            <div className="rounded-lg border border-border/60 bg-muted/20 p-3">
              <p className="text-xs text-muted-foreground">Still to enrich</p>
              <p className="text-2xl font-semibold">{fmt(summary.rows_waiting)}</p>
              <p className="mt-1 text-[11px] text-muted-foreground">
                {summary.rows_failed ? `${fmt(summary.rows_failed)} need a retry` : "queued"}
              </p>
            </div>
            <div className="rounded-lg border border-border/60 bg-muted/20 p-3">
              <p className="flex items-center gap-1 text-xs text-muted-foreground">
                <Gauge className="h-3.5 w-3.5" />
                Average confidence
              </p>
              <p className="text-2xl font-semibold">
                {summary.avg_confidence === null
                  ? "—"
                  : `${Math.round(Number(summary.avg_confidence) * 100)}%`}
              </p>
              <p className="mt-1 text-[11px] text-muted-foreground">
                from {fmt(summary.sampled_rows)} sampled rows
              </p>
            </div>
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <div className="rounded-lg border border-border/60 bg-muted/20 p-3">
              <p className="flex items-center gap-1 text-xs font-medium">
                <Layers className="h-3.5 w-3.5 text-primary" />
                Signals you already have
              </p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {summary.signal_families.length ? (
                  summary.signal_families.map((f) => (
                    <Badge key={f.family} variant="secondary" className="text-[10px]">
                      {f.family} · {fmt(f.rows)}
                    </Badge>
                  ))
                ) : (
                  <span className="text-xs text-muted-foreground">No signal families yet.</span>
                )}
              </div>
              <p className="mt-3 text-xs font-medium">Most common audience tags</p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {summary.top_tags.length ? (
                  summary.top_tags.slice(0, 12).map((t) => (
                    <Badge key={t.tag} variant="outline" className="text-[10px]">
                      {t.tag}
                    </Badge>
                  ))
                ) : (
                  <span className="text-xs text-muted-foreground">No tags in the sample.</span>
                )}
              </div>
            </div>

            <div className="rounded-lg border border-border/60 bg-muted/20 p-3">
              <p className="text-xs font-medium">Results you can measure against</p>
              {summary.kpi_events.length ? (
                <ul className="mt-2 space-y-1 text-xs">
                  {summary.kpi_events.map((k) => (
                    <li key={k.event} className="flex items-center justify-between gap-2">
                      <span className="truncate">{k.event}</span>
                      <span className="text-muted-foreground">{fmt(k.events)}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-2 text-xs text-muted-foreground">
                  No tracked events in the last 90 days. Add your site tag under Tracking &amp;
                  pixels to start measuring site traffic, click-through and time on site against
                  these scores.
                </p>
              )}
              <p className="mt-3 text-[11px] text-muted-foreground">
                Updated {new Date(summary.computed_at).toLocaleString()}
              </p>
            </div>
          </div>
        </>
      )}
    </Card>
  );
}
