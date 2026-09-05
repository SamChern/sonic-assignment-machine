import { useCallback, useMemo, useState } from "react";
import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { friendlyError } from "@/lib/friendlyError";
import { toast } from "@/hooks/use-toast";
import { KPI_OPTIONS } from "@/lib/enterpriseSchema";
import { AlertTriangle, LineChart, Loader2, Play } from "lucide-react";
import {
  CATEGORIES,
  type CategoryName,
  type DatasetOption,
  type LiftReport,
  type OutcomeResult,
} from "@/components/enterprise/outcomes/types";
import { DriversCard } from "@/components/enterprise/outcomes/DriversCard";
import { CounterfactualCard } from "@/components/enterprise/outcomes/CounterfactualCard";
import { LiftPriorsCard } from "@/components/enterprise/outcomes/LiftPriorsCard";
import { TopPerformersCard } from "@/components/enterprise/outcomes/TopPerformersCard";
import { MeasureLiftCard } from "@/components/enterprise/outcomes/MeasureLiftCard";

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
          <DriversCard result={result} />
          <CounterfactualCard
            result={result}
            deltas={deltas}
            setDeltas={setDeltas}
            counterfactual={counterfactual}
          />
          <LiftPriorsCard result={result} />
          <TopPerformersCard result={result} />
        </>
      )}
      <MeasureLiftCard
        cohortSlugs={cohortSlugs}
        liftSlug={liftSlug}
        setLiftSlug={setLiftSlug}
        measureLift={measureLift}
        liftRunning={liftRunning}
        liftError={liftError}
        lift={lift}
      />
    </div>
  );
};

export default PredictOutcomesPanel;
