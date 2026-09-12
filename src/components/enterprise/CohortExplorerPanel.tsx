/**
 * Admin-only drill-down over a predicted segment.
 *
 * Pick a saved segment and see the people in it: match strength, whether they
 * are held back for measurement, the six scores and how they were grounded,
 * plus the measured site tag values for those devices next to everyone else.
 */
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
import { ChevronLeft, ChevronRight, Loader2, RefreshCw, Telescope } from "lucide-react";
import useCohortExplorer, { COHORT_PAGE_SIZE } from "@/hooks/useCohortExplorer";

const CATEGORIES = [
  "emotional",
  "cognitive",
  "social",
  "communication",
  "contextual",
  "artistic",
] as const;

const fmt = (n: number | null | undefined) => Math.round(n ?? 0).toLocaleString();
const pct = (v: number | null | undefined) =>
  v === null || v === undefined ? "—" : `${Math.round(v * 100)}%`;
const num = (v: number | null | undefined) =>
  v === null || v === undefined ? "—" : Math.round(v).toString();

const Metric = ({ label, value, hint }: { label: string; value: string; hint?: string }) => (
  <div className="rounded-lg border border-border/60 bg-muted/20 p-3">
    <p className="text-xs text-muted-foreground">{label}</p>
    <p className="text-lg font-semibold">{value}</p>
    {hint && <p className="mt-1 text-[11px] text-muted-foreground">{hint}</p>}
  </div>
);

export default function CohortExplorerPanel() {
  const {
    cohorts,
    cohortId,
    select,
    data,
    page,
    setPage,
    listLoading,
    loading,
    error,
    refresh,
  } = useCohortExplorer();

  const maxPage = data ? Math.max(0, Math.ceil(data.sampled / COHORT_PAGE_SIZE) - 1) : 0;

  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Telescope className="h-4 w-4 text-primary" aria-hidden="true" />
          <div>
            <h3 className="text-sm font-semibold">Segment explorer</h3>
            <p className="text-xs text-muted-foreground">
              Drill into a predicted segment: who is in it, their scores, and what your site tags
              measured for them.
            </p>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={() => void refresh()} disabled={loading}>
          {loading ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
          ) : (
            <RefreshCw className="mr-2 h-4 w-4" aria-hidden="true" />
          )}
          Refresh
        </Button>
      </div>

      <div className="mt-4 max-w-sm">
        <Select value={cohortId} onValueChange={select} disabled={listLoading || !cohorts.length}>
          <SelectTrigger aria-label="Predicted segment">
            <SelectValue placeholder={listLoading ? "Loading segments…" : "Choose a segment"} />
          </SelectTrigger>
          <SelectContent>
            {cohorts.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.name ?? c.slug ?? c.id.slice(0, 8)} · {fmt(c.members)} people
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {error && (
        <p className="mt-3 text-xs text-destructive">{error}</p>
      )}

      {!listLoading && !cohorts.length && !error && (
        <p className="mt-3 text-xs text-muted-foreground">
          No segments saved yet — save one from a match above and it will appear here.
        </p>
      )}

      {data && (
        <div className="mt-4 space-y-4">
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <Metric label="People in segment" value={fmt(data.members)} />
            <Metric
              label="Held back for measurement"
              value={fmt(data.holdout)}
              hint="Kept out of activation so lift can be measured"
            />
            <Metric label="Average match strength" value={pct(data.avg_similarity)} />
            <Metric
              label="With scores"
              value={fmt(data.scored)}
              hint={`${fmt(data.audio_grounded)} grounded in real audio`}
            />
          </div>

          {Object.keys(data.avg_scores ?? {}).length > 0 && (
            <div>
              <p className="text-xs font-medium">Average scores across this segment</p>
              <div className="mt-2 grid gap-2 sm:grid-cols-3 lg:grid-cols-6">
                {CATEGORIES.map((c) => (
                  <div key={c} className="rounded-lg border border-border/60 p-2 text-center">
                    <p className="text-[11px] capitalize text-muted-foreground">{c}</p>
                    <p className="text-base font-semibold">{num(data.avg_scores[c])}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs font-medium">
                People in this segment ({fmt(data.sampled)} strongest matches read)
              </p>
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Previous page"
                  onClick={() => setPage(Math.max(0, page - 1))}
                  disabled={page === 0 || loading}
                >
                  <ChevronLeft className="h-4 w-4" aria-hidden="true" />
                </Button>
                <span className="text-xs text-muted-foreground">
                  {page + 1} / {maxPage + 1}
                </span>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Next page"
                  onClick={() => setPage(Math.min(maxPage, page + 1))}
                  disabled={page >= maxPage || loading}
                >
                  <ChevronRight className="h-4 w-4" aria-hidden="true" />
                </Button>
              </div>
            </div>

            <div className="mt-2 overflow-x-auto">
              <table className="w-full min-w-[720px] text-xs">
                <thead className="text-muted-foreground">
                  <tr className="border-b border-border/60 text-left">
                    <th className="py-1.5 pr-3 font-medium">Device</th>
                    <th className="py-1.5 pr-3 font-medium">Match</th>
                    <th className="py-1.5 pr-3 font-medium">Grounding</th>
                    <th className="py-1.5 pr-3 font-medium">Confidence</th>
                    {CATEGORIES.map((c) => (
                      <th key={c} className="py-1.5 pr-2 font-medium capitalize">
                        {c.slice(0, 3)}
                      </th>
                    ))}
                    <th className="py-1.5 font-medium">Role</th>
                  </tr>
                </thead>
                <tbody>
                  {data.devices.map((d) => (
                    <tr key={d.subject_key} className="border-b border-border/40">
                      <td className="py-1.5 pr-3 font-mono text-[11px]">{d.subject_key}</td>
                      <td className="py-1.5 pr-3">{pct(d.similarity)}</td>
                      <td className="py-1.5 pr-3">
                        <Badge
                          variant={d.grounding_level === "audio-grounded" ? "default" : "outline"}
                          className="text-[10px]"
                        >
                          {d.grounding_level}
                        </Badge>
                      </td>
                      <td className="py-1.5 pr-3">{pct(d.confidence)}</td>
                      {CATEGORIES.map((c) => (
                        <td key={c} className="py-1.5 pr-2">
                          {num(d.scores?.[c] ?? null)}
                        </td>
                      ))}
                      <td className="py-1.5">{d.holdout ? "held back" : "exposed"}</td>
                    </tr>
                  ))}
                  {!data.devices.length && (
                    <tr>
                      <td colSpan={11} className="py-3 text-center text-muted-foreground">
                        No people on this page.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div>
            <p className="text-xs font-medium">
              Site tag values, last {data.window_days} days
            </p>
            {data.tag_impact.length ? (
              <>
                <div className="mt-2 overflow-x-auto">
                  <table className="w-full min-w-[560px] text-xs">
                    <thead className="text-muted-foreground">
                      <tr className="border-b border-border/60 text-left">
                        <th className="py-1.5 pr-3 font-medium">Tag</th>
                        <th className="py-1.5 pr-3 font-medium">Segment devices</th>
                        <th className="py-1.5 pr-3 font-medium">Segment average</th>
                        <th className="py-1.5 pr-3 font-medium">Everyone else</th>
                        <th className="py-1.5 font-medium">Difference</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.tag_impact.map((t) => (
                        <tr key={t.kpi_metric} className="border-b border-border/40">
                          <td className="py-1.5 pr-3">{t.kpi_metric}</td>
                          <td className="py-1.5 pr-3">{fmt(t.segment_devices)}</td>
                          <td className="py-1.5 pr-3">
                            {t.segment_avg === null ? "—" : t.segment_avg.toLocaleString()}
                          </td>
                          <td className="py-1.5 pr-3">
                            {t.other_avg === null ? "—" : t.other_avg.toLocaleString()}
                          </td>
                          <td className="py-1.5">
                            {t.lift_pct === null || t.segment_devices === 0
                              ? "not measured yet"
                              : `${t.lift_pct > 0 ? "+" : ""}${t.lift_pct}%`}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  {fmt(data.tag_devices)} of this segment's devices have measured tag events.
                </p>
              </>
            ) : (
              <p className="mt-2 text-xs text-muted-foreground">
                No measured tag events in this window yet, so no difference can be shown.
              </p>
            )}
          </div>
        </div>
      )}
    </Card>
  );
}
