import { useCallback, useMemo, useState } from "react";
import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
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
import { Slider } from "@/components/ui/slider";
import { friendlyError } from "@/lib/friendlyError";
import { toast } from "@/hooks/use-toast";
import { KPI_OPTIONS } from "@/lib/enterpriseSchema";
import { AlertTriangle, HelpCircle, LineChart, Loader2, Play, TrendingUp } from "lucide-react";

const CATEGORIES = [
  "emotional",
  "cognitive",
  "social",
  "communication",
  "contextual",
  "artistic",
] as const;

type CategoryName = (typeof CATEGORIES)[number];

interface Driver {
  category: string;
  coefficient: number;
  per_10_points: number;
  per_10_ci: [number, number];
  ci_low: number;
  ci_high: number;
  /** True when the bootstrap interval crosses zero: not yet distinguishable. */
  inconclusive: boolean;
}

interface LiftPrior {
  category: string;
  lift: number;
  ci_low: number;
  ci_high: number;
  exposed_n: number;
  holdout_n: number;
  cohort_slug: string;
}

interface OutcomeResult {
  kpi: string;
  kpi_source: string;
  matched_rows: number;
  min_rows: number;
  engine: string;
  bootstrap_iters: number;
  intercept: number;
  r2: number;
  mean_actual: number;
  mean_scores: Record<string, number>;
  conclusive_count: number;
  lift_priors: LiftPrior[];
  drivers: Driver[];
  top_predicted: { record_id: string; label: string; predicted: number; actual: number | null }[];
}

interface LiftReport {
  exposed_events: number;
  holdout_events: number;
  exposed_mean: number;
  holdout_mean: number;
  absolute_lift: number;
  relative_lift: number | null;
  measurable: boolean;
  priors_written: number;
  note?: string;
}

interface DatasetOption {
  id: string;
  name: string;
}

const PredictOutcomesPanel = ({
  organizationId,
  canWrite,
  datasets,
}: {
  organizationId: string;
  canWrite: boolean;
  datasets: DatasetOption[];
}) => {
  const [kpi, setKpi] = useState<string>(KPI_OPTIONS[2].key);
  const [kpiSource, setKpiSource] = useState<"upload" | "pixel">("upload");
  const [datasetId, setDatasetId] = useState<string>("all");
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<OutcomeResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [gate, setGate] = useState<{ matched_rows: number; min_rows: number } | null>(null);
  const [cohortSlugs, setCohortSlugs] = useState<{ slug: string; name: string }[]>([]);
  const [liftSlug, setLiftSlug] = useState<string>("");
  const [liftRunning, setLiftRunning] = useState(false);
  const [lift, setLift] = useState<LiftReport | null>(null);
  const [liftError, setLiftError] = useState<string | null>(null);
  /** Counterfactual deltas, in points, per category. */
  const [deltas, setDeltas] = useState<Record<CategoryName, number>>(
    Object.fromEntries(CATEGORIES.map((c) => [c, 0])) as Record<CategoryName, number>,
  );

  const run = useCallback(async () => {
    setRunning(true);
    setError(null);
    setResult(null);
    setGate(null);
    setDeltas(Object.fromEntries(CATEGORIES.map((c) => [c, 0])) as Record<CategoryName, number>);
    try {
      const { data, error: fnErr } = await supabase.functions.invoke("predict-outcomes", {
        body: {
          organization_id: organizationId,
          kpi,
          kpi_source: kpiSource,
          dataset_id: datasetId === "all" ? null : datasetId,
        },
      });
      if (fnErr && !data) throw new Error(fnErr.message);
      if (!data?.success) {
        if (data?.gated) {
          setGate({ matched_rows: Number(data.matched_rows ?? 0), min_rows: Number(data.min_rows ?? 0) });
        }
        throw new Error(data?.error ?? fnErr?.message ?? "Model could not be fitted");
      }
      setResult(data as OutcomeResult);
      toast({
        title: "Outcome model fitted",
        description: `${data.matched_rows} rows · fit ${(data.r2 * 100).toFixed(0)}%`,
      });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRunning(false);
    }
  }, [organizationId, kpi, kpiSource, datasetId]);

  // Enterprise members read cohorts as aggregates only — never member keys.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const { data } = await supabase.rpc("org_cohort_aggregates", { _org: organizationId });
      if (cancelled) return;
      const rows = (data ?? []) as { slug: string; name: string }[];
      setCohortSlugs(rows);
      setLiftSlug((prev) => prev || rows[0]?.slug || "");
    })();
    return () => {
      cancelled = true;
    };
  }, [organizationId]);

  const measureLift = useCallback(async () => {
    setLiftRunning(true);
    setLiftError(null);
    setLift(null);
    try {
      const { data, error: fnErr } = await supabase.functions.invoke("activation-lift", {
        body: { organization_id: organizationId, cohort_slug: liftSlug, kpi },
      });
      if (fnErr && !data) throw new Error(fnErr.message);
      if (!data?.success) throw new Error(data?.error ?? fnErr?.message ?? "Lift not available");
      setLift(data as LiftReport);
      toast({
        title: "Result measured",
        description: `${data.exposed_events} responses from people who heard it vs. ${data.holdout_events} from the withheld group.`,
      });
    } catch (e) {
      setLiftError(friendlyError((e as Error).message));
    } finally {
      setLiftRunning(false);
    }
  }, [organizationId, liftSlug, kpi]);

  /** Predicted KPI at the counterfactual point, plus the supported interval. */
  const counterfactual = useMemo(() => {
    if (!result) {
      return { predicted: 0, delta: 0, ciLow: 0, ciHigh: 0, conclusive: false };
    }
    const base = result.intercept +
      result.drivers.reduce(
        (s, d) => s + d.coefficient * ((result.mean_scores[d.category] ?? 0) / 100),
        0,
      );
    let delta = 0;
    let ciLow = 0;
    let ciHigh = 0;
    let conclusive = false;
    for (const d of result.drivers) {
      const pts = deltas[d.category as CategoryName] ?? 0;
      if (!pts) continue;
      delta += d.coefficient * (pts / 100);
      if (!d.inconclusive) {
        conclusive = true;
        const a = d.ci_low * (pts / 100);
        const b = d.ci_high * (pts / 100);
        ciLow += Math.min(a, b);
        ciHigh += Math.max(a, b);
      }
    }
    return { predicted: base + delta, delta, ciLow, ciHigh, conclusive };
  }, [result, deltas]);

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <div className="flex flex-wrap items-center gap-2">
          <LineChart className="h-4 w-4 text-primary" />
          <h2 className="text-sm font-semibold">Predict SonicSIM-Outcomes</h2>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          Fits your chosen KPI against the 6 semantic categories, so you can see which category
          actually moves the number and which sources are predicted to perform best.
        </p>

        <div className="mt-3 grid gap-2 sm:grid-cols-3">
          <Select value={kpi} onValueChange={setKpi}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {KPI_OPTIONS.map((k) => (
                <SelectItem key={k.key} value={k.key}>
                  {k.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={kpiSource} onValueChange={(v) => setKpiSource(v as "upload" | "pixel")}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="upload">KPI from uploaded data</SelectItem>
              <SelectItem value="pixel">KPI from tracking tag events</SelectItem>
            </SelectContent>
          </Select>
          <Select value={datasetId} onValueChange={setDatasetId}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All datasets</SelectItem>
              {datasets.map((d) => (
                <SelectItem key={d.id} value={d.id}>
                  {d.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <Button size="sm" className="mt-3" onClick={run} disabled={running || !canWrite}>
          {running ? (
            <Loader2 className="mr-1 h-4 w-4 animate-spin" />
          ) : (
            <Play className="mr-1 h-4 w-4" />
          )}
          Run prediction
        </Button>

        {gate && (
          <p className="mt-3 text-[11px] text-muted-foreground">
            Needs at least {gate.min_rows} scored rows with a {kpi} value attached — you have{" "}
            {gate.matched_rows}. Category-level claims stay hidden until then rather than guessing.
          </p>
        )}

        {error && (
          <p className="mt-3 flex items-start gap-1 text-[11px] text-destructive">
            <AlertTriangle className="mt-[2px] h-3 w-3 shrink-0" />
            {error}
          </p>
        )}
      </Card>

      {result && (
        <>
          <Card className="p-4">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-sm font-semibold">What moves {result.kpi}</h3>
              <Badge variant="outline" className="text-[11px]">
                {result.matched_rows} rows · fit {(result.r2 * 100).toFixed(0)}%
              </Badge>
              <Badge variant="outline" className="text-[11px]">
                avg {result.mean_actual.toFixed(3)}
              </Badge>
              <Badge variant="outline" className="text-[11px]">
                {result.conclusive_count} of 6 axes distinguishable
              </Badge>
            </div>
            <div className="mt-3 space-y-2">
              {result.drivers.map((d) => {
                const conclusive = result.drivers.filter((x) => !x.inconclusive);
                const max = Math.max(...conclusive.map((x) => Math.abs(x.coefficient)), 1e-9);
                const pct = Math.min(100, (Math.abs(d.coefficient) / max) * 100);
                return (
                  <div
                    key={d.category}
                    className={`flex flex-wrap items-center gap-2 ${
                      d.inconclusive ? "opacity-50" : ""
                    }`}
                  >
                    <span className="w-28 text-xs capitalize">{d.category}</span>
                    <div className="h-2 min-w-[100px] flex-1 overflow-hidden rounded bg-muted">
                      <div
                        className={`h-full ${
                          d.inconclusive
                            ? "bg-muted-foreground/40"
                            : d.coefficient >= 0
                              ? "bg-primary"
                              : "bg-destructive"
                        }`}
                        style={{ width: `${d.inconclusive ? 12 : pct}%` }}
                      />
                    </div>
                    {d.inconclusive ? (
                      <span className="flex w-52 items-center justify-end gap-1 text-right text-[11px] text-muted-foreground">
                        <HelpCircle className="h-3 w-3" />
                        not yet distinguishable · needs more data
                      </span>
                    ) : (
                      <span className="w-52 text-right text-[11px] text-muted-foreground">
                        {d.per_10_points >= 0 ? "+" : ""}
                        {d.per_10_points.toFixed(4)} / +10 pts
                        <span className="ml-1 opacity-70">
                          [{d.per_10_ci[0].toFixed(4)}, {d.per_10_ci[1].toFixed(4)}]
                        </span>
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
            <p className="mt-3 text-[11px] text-muted-foreground">
              Effects are ridge-regularized with {result.bootstrap_iters} bootstrap resamples on the{" "}
              {result.engine === "remote" ? "analysis worker" : "in-cloud fallback"}. Greyed rows are
              not yet distinguishable from zero — treat them as unknown, not as neutral.
            </p>
          </Card>

          <Card className="p-4">
            <div className="flex flex-wrap items-center gap-2">
              <TrendingUp className="h-4 w-4 text-primary" />
              <h3 className="text-sm font-semibold">Counterfactual planning</h3>
              <Badge variant="outline" className="text-[11px]">
                predicted {counterfactual.predicted.toFixed(4)}
              </Badge>
              <Badge
                variant={counterfactual.conclusive ? "default" : "outline"}
                className="text-[11px]"
              >
                {counterfactual.delta >= 0 ? "+" : ""}
                {counterfactual.delta.toFixed(4)} vs. today
              </Badge>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              Move an axis and see the predicted change in {result.kpi}, with the interval the data
              actually supports. Intervals from inconclusive axes are excluded from the total.
            </p>
            <div className="mt-3 space-y-3">
              {result.drivers.map((d) => (
                <div key={`cf-${d.category}`} className="flex flex-wrap items-center gap-2">
                  <span className="w-28 text-xs capitalize">{d.category}</span>
                  <Slider
                    value={[deltas[d.category as CategoryName] ?? 0]}
                    min={-20}
                    max={20}
                    step={1}
                    aria-label={`${d.category} delta`}
                    onValueChange={([v]) =>
                      setDeltas((p) => ({ ...p, [d.category as CategoryName]: v }))
                    }
                    className="min-w-[140px] flex-1"
                  />
                  <span className="w-28 text-right text-[11px] text-muted-foreground">
                    {(deltas[d.category as CategoryName] ?? 0) >= 0 ? "+" : ""}
                    {deltas[d.category as CategoryName] ?? 0} pts
                    {d.inconclusive && " · unknown"}
                  </span>
                </div>
              ))}
            </div>
            <p className="mt-3 text-[11px] text-muted-foreground">
              Interval: {counterfactual.conclusive
                ? `${counterfactual.ciLow.toFixed(4)} to ${counterfactual.ciHigh.toFixed(4)}`
                : "no distinguishable axis moved — no interval to report"}
            </p>
          </Card>

          {result.lift_priors.length > 0 && (
            <Card className="p-4">
              <h3 className="text-sm font-semibold">What the audio actually moved</h3>
              <p className="mt-1 text-[11px] text-muted-foreground">
                People who heard it vs. the withheld group, from live responses — a real difference, not a coincidence,
                and it feeds back into your calibration.
              </p>
              <div className="mt-3 space-y-1">
                {result.lift_priors.map((p) => (
                  <div
                    key={`${p.cohort_slug}-${p.category}`}
                    className="flex flex-wrap items-center gap-2 rounded-lg border border-border/50 bg-muted/10 p-2 text-xs"
                  >
                    <span className="w-28 capitalize">{p.category}</span>
                    <span className="min-w-0 flex-1 truncate text-muted-foreground">
                      {p.cohort_slug}
                    </span>
                    <span className={p.lift >= 0 ? "text-primary" : "text-destructive"}>
                      {p.lift >= 0 ? "+" : ""}
                      {p.lift.toFixed(4)}
                    </span>
                    <span className="text-[11px] text-muted-foreground">
                      {p.exposed_n} exposed / {p.holdout_n} holdout
                    </span>
                  </div>
                ))}
              </div>
            </Card>
          )}

          <Card className="p-4">
            <h3 className="text-sm font-semibold">Predicted top performers</h3>
            <div className="mt-3 space-y-1">
              {result.top_predicted.map((t, i) => (
                <div
                  key={t.record_id}
                  className="flex items-center gap-2 rounded-lg border border-border/50 bg-muted/10 p-2 text-xs"
                >
                  <span className="w-6 text-muted-foreground">{i + 1}</span>
                  <span className="min-w-0 flex-1 truncate">{t.label}</span>
                  <span className="font-medium">{t.predicted.toFixed(4)}</span>
                  {t.actual !== null && (
                    <span className="text-muted-foreground">actual {t.actual.toFixed(4)}</span>
                  )}
                </div>
              ))}
            </div>
          </Card>
        </>
      )}
      {cohortSlugs.length > 0 && (
        <Card className="p-4">
          <div className="flex flex-wrap items-center gap-2">
            <TrendingUp className="h-4 w-4 text-primary" />
            <h3 className="text-sm font-semibold">Measure the difference it made</h3>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            Every audience file holds back about one person in ten. Comparing how the people who
            heard it responded against that withheld group shows the difference the audio made —
            not just a coincidence — and it feeds straight back into how we score.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Select value={liftSlug} onValueChange={setLiftSlug}>
              <SelectTrigger className="w-[240px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {cohortSlugs.map((c) => (
                  <SelectItem key={c.slug} value={c.slug}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button size="sm" variant="outline" onClick={measureLift} disabled={liftRunning || !liftSlug}>
              {liftRunning ? (
                <Loader2 className="mr-1 h-4 w-4 animate-spin" />
              ) : (
                <Play className="mr-1 h-4 w-4" />
              )}
              Measure the difference
            </Button>
          </div>
          {liftError && (
            <p className="mt-3 flex items-start gap-1 text-[11px] text-destructive">
              <AlertTriangle className="mt-[2px] h-3 w-3 shrink-0" />
              {liftError}
            </p>
          )}
          {lift && (
            <div className="mt-3 space-y-1 text-xs">
              <p>
                People who heard it: {lift.exposed_mean.toFixed(4)} ({lift.exposed_events}{" "}
                responses) · withheld group: {lift.holdout_mean.toFixed(4)} ({lift.holdout_events}{" "}
                responses)
              </p>
              <p className={lift.absolute_lift >= 0 ? "text-primary" : "text-destructive"}>
                Difference {lift.absolute_lift >= 0 ? "+" : ""}
                {lift.absolute_lift.toFixed(4)}
                {lift.relative_lift !== null && ` (${(lift.relative_lift * 100).toFixed(1)}%)`}
              </p>
              {lift.note && <p className="text-[11px] text-muted-foreground">{lift.note}</p>}
              {lift.priors_written > 0 && (
                <p className="text-[11px] text-muted-foreground">
                  {lift.priors_written} per-axis priors written back to calibration.
                </p>
              )}
            </div>
          )}
        </Card>
      )}
    </div>
  );
};

export default PredictOutcomesPanel;
