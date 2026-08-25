import { useCallback, useState } from "react";
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
import { toast } from "@/hooks/use-toast";
import { KPI_OPTIONS } from "@/lib/enterpriseSchema";
import { AlertTriangle, LineChart, Loader2, Play } from "lucide-react";

interface Driver {
  category: string;
  coefficient: number;
  per_10_points: number;
}

interface OutcomeResult {
  kpi: string;
  kpi_source: string;
  matched_rows: number;
  r2: number;
  mean_actual: number;
  drivers: Driver[];
  top_predicted: { record_id: string; label: string; predicted: number; actual: number | null }[];
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

  const run = useCallback(async () => {
    setRunning(true);
    setError(null);
    setResult(null);
    try {
      const { data, error: fnErr } = await supabase.functions.invoke("predict-outcomes", {
        body: {
          organization_id: organizationId,
          kpi,
          kpi_source: kpiSource,
          dataset_id: datasetId === "all" ? null : datasetId,
        },
      });
      if (fnErr) throw new Error(fnErr.message);
      if (!data?.success) throw new Error(data?.error ?? "Model could not be fitted");
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
            </div>
            <div className="mt-3 space-y-2">
              {result.drivers.map((d) => {
                const max = Math.max(...result.drivers.map((x) => Math.abs(x.coefficient))) || 1;
                const pct = (Math.abs(d.coefficient) / max) * 100;
                return (
                  <div key={d.category} className="flex items-center gap-2">
                    <span className="w-28 text-xs capitalize">{d.category}</span>
                    <div className="h-2 flex-1 overflow-hidden rounded bg-muted">
                      <div
                        className={`h-full ${d.coefficient >= 0 ? "bg-primary" : "bg-destructive"}`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <span className="w-28 text-right text-[11px] text-muted-foreground">
                      {d.per_10_points >= 0 ? "+" : ""}
                      {d.per_10_points.toFixed(4)} / +10 pts
                    </span>
                  </div>
                );
              })}
            </div>
            <p className="mt-3 text-[11px] text-muted-foreground">
              Fit below roughly 20% means the semantic profile alone does not explain this KPI yet —
              add more rows with observed values, or capture live events with the tracking tag.
            </p>
          </Card>

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
    </div>
  );
};

export default PredictOutcomesPanel;
