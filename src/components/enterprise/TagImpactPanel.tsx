import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, RefreshCw, Target, TrendingDown, TrendingUp } from "lucide-react";
import { useTagImpact } from "@/hooks/useTagImpact";

const CATEGORY_LABEL: Record<string, string> = {
  emotional: "Emotional",
  cognitive: "Cognitive",
  social: "Social",
  communication: "Communication",
  contextual: "Contextual",
  artistic: "Artistic",
};

const num = (n: number, digits = 2) =>
  n.toLocaleString(undefined, { maximumFractionDigits: digits });

/**
 * Each of the account's audio rows with its predicted effect on one measured
 * site tag, using the relationship fitted from the account's own tagged events.
 */
export default function TagImpactPanel({ organizationId }: { organizationId: string }) {
  const { data, loading, error, metric, selectMetric, reload } = useTagImpact(organizationId);

  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-center gap-2">
        <p className="flex items-center gap-2 text-sm font-semibold">
          <Target className="h-4 w-4 text-primary" />
          Predicted impact on your site tags
        </p>
        {data?.fitted && (
          <Badge variant="outline" className="text-[11px]">
            fitted on {data.matched_rows?.toLocaleString()} measured devices
          </Badge>
        )}
        <div className="ml-auto flex items-center gap-2">
          {!!data?.tags.length && (
            <Select value={metric ?? undefined} onValueChange={selectMetric}>
              <SelectTrigger className="h-9 w-[190px]">
                <SelectValue placeholder="Site tag" />
              </SelectTrigger>
              <SelectContent>
                {data.tags.map((t) => (
                  <SelectItem key={t.kpi_metric} value={t.kpi_metric}>
                    {t.kpi_metric} ({t.devices.toLocaleString()})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <Button variant="outline" size="sm" onClick={reload} disabled={loading}>
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
        We compare the six scores on your enriched device rows with the values your own site tag
        recorded, then apply that relationship to each track you've analysed.
      </p>

      {error && (
        <p className="mt-3 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-xs">
          Couldn't work this out: {error}
        </p>
      )}

      {data && !data.fitted && (
        <p className="mt-3 rounded-lg border border-border/60 bg-muted/20 p-3 text-xs text-muted-foreground">
          {data.reason === "no_tags"
            ? "No site tag has recorded a measurable value in the last 90 days. Add your tag under Tracking & pixels, then come back."
            : data.reason === "not_enough_matches"
              ? `Not enough measured evidence yet — ${data.matched_rows?.toLocaleString() ?? 0} of the ${data.min_rows ?? 24} device rows needed for "${data.kpi_metric}". Once more tagged visits match your enriched rows, the impact appears here.`
              : `The six scores on the matched rows are too alike to separate an effect on "${data.kpi_metric}" yet.`}
        </p>
      )}

      {data?.fitted && (
        <>
          <div className="mt-4 flex flex-wrap gap-1.5">
            {(data.drivers ?? []).map((d) => (
              <Badge
                key={d.category}
                variant={d.inconclusive ? "outline" : "secondary"}
                className={`text-[10px] ${d.inconclusive ? "opacity-60" : ""}`}
                title={
                  d.inconclusive
                    ? "Not yet distinguishable from no effect."
                    : `95% interval ${num(d.per_10_ci[0])} to ${num(d.per_10_ci[1])} per +10 points.`
                }
              >
                {CATEGORY_LABEL[d.category] ?? d.category}{" "}
                {d.inconclusive
                  ? "· unclear"
                  : `· ${d.per_10_points > 0 ? "+" : ""}${num(d.per_10_points)} per +10`}
              </Badge>
            ))}
          </div>

          <p className="mt-2 text-[11px] text-muted-foreground">
            Typical {data.kpi_metric} across matched devices: {num(data.baseline ?? 0)}. Each row
            below is the value predicted for that track's score mix.
          </p>

          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[520px] text-xs">
              <caption className="sr-only">
                Predicted {data.kpi_metric} per analysed audio row
              </caption>
              <thead>
                <tr className="text-left text-muted-foreground">
                  <th className="py-1.5 pr-2 font-medium">Audio</th>
                  <th className="py-1.5 pr-2 font-medium">Predicted</th>
                  <th className="py-1.5 pr-2 font-medium">vs typical</th>
                  <th className="py-1.5 pr-2 font-medium">Leading score</th>
                </tr>
              </thead>
              <tbody>
                {(data.rows ?? []).map((r) => {
                  const up = r.delta >= 0;
                  return (
                    <tr key={r.analysis_id} className="border-t border-border/50">
                      <td className="max-w-[220px] py-1.5 pr-2">
                        <span className="block truncate" title={r.source_name}>
                          {r.source_name}
                        </span>
                      </td>
                      <td className="py-1.5 pr-2 tabular-nums">{num(r.predicted)}</td>
                      <td
                        className={`py-1.5 pr-2 tabular-nums ${up ? "text-primary" : "text-muted-foreground"}`}
                      >
                        <span className="flex items-center gap-1">
                          {up ? (
                            <TrendingUp className="h-3.5 w-3.5" aria-hidden="true" />
                          ) : (
                            <TrendingDown className="h-3.5 w-3.5" aria-hidden="true" />
                          )}
                          {up ? "+" : ""}
                          {num(r.delta)}
                          {r.delta_pct === null ? "" : ` (${up ? "+" : ""}${num(r.delta_pct, 0)}%)`}
                        </span>
                      </td>
                      <td className="py-1.5 pr-2 text-muted-foreground">
                        {r.lead_category ? (CATEGORY_LABEL[r.lead_category] ?? r.lead_category) : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {!data.rows?.length && (
            <p className="mt-2 text-xs text-muted-foreground">
              No analysed audio yet — upload a track and it will appear here.
            </p>
          )}

          <p className="mt-3 text-[11px] text-muted-foreground">
            {data.audio_source === "account_data_rows"
              ? "Tracks matched from the audio named on your own data rows. "
              : ""}
            Updated {new Date(data.computed_at).toLocaleString()}
          </p>
        </>
      )}
    </Card>
  );
}
