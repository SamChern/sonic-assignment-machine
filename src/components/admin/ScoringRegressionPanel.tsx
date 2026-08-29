// Step 4 verification: re-score a fixed set of sources and diff the six axes
// against their stored analyses, plus a tag-only smoke test that asserts the
// librosa branch is never touched. Admin only.
import { useCallback, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { AlertTriangle, CheckCircle2, GitCompare, Loader2, Play } from "lucide-react";
import { toast } from "sonner";

const AXES = [
  "emotional",
  "cognitive",
  "social",
  "communication",
  "contextual",
  "artistic",
] as const;

interface AxisStat {
  n: number;
  mean_drift: number;
  max_drift: number;
}

interface RegressionRun {
  success: boolean;
  mode: string;
  tolerance: number;
  checked: number;
  failures: number;
  passed: boolean;
  librosa_calls_during_run: number;
  axis_summary: Record<string, AxisStat>;
  details: Array<{
    id: string;
    name: string;
    tag_only?: boolean;
    tag_count?: number;
    max_drift?: number;
    within_tolerance?: boolean | null;
    error?: string;
  }>;
  note?: string;
  error?: string;
}

export const ScoringRegressionPanel = () => {
  const [run, setRun] = useState<RegressionRun | null>(null);
  const [busy, setBusy] = useState<"calibration" | "tag_only" | null>(null);

  const start = useCallback(async (mode: "calibration" | "tag_only") => {
    setBusy(mode);
    const { data, error } = await supabase.functions.invoke("scoring-regression", {
      body: { mode, limit: 50 },
    });
    setBusy(null);
    if (error || !data?.success) {
      toast.error(
        mode === "tag_only" ? "Tag-only smoke test failed" : "Calibration re-score failed",
        { description: error?.message ?? data?.error ?? "Unknown error" },
      );
      return;
    }
    setRun(data as RegressionRun);
    toast[data.passed ? "success" : "warning"](
      data.passed ? "Within calibration tolerance" : `${data.failures} source(s) outside tolerance`,
      { description: `${data.checked} source(s) re-scored` },
    );
  }, []);

  const offenders = (run?.details ?? []).filter(
    (d) => d.error || d.within_tolerance === false,
  );

  return (
    <Card className="p-4 sm:p-5 space-y-4 bg-card/60 backdrop-blur border-border/60">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="flex items-center gap-2 text-sm font-semibold">
            <GitCompare className="h-4 w-4 text-primary" aria-hidden />
            Scoring regression
          </h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Re-scores a deterministic set of sources with the cache bypassed and compares
            each axis with its stored analysis. Nothing is saved.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="outline"
            className="h-8 text-xs"
            disabled={busy !== null}
            onClick={() => start("calibration")}
          >
            {busy === "calibration"
              ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden />
              : <Play className="mr-1.5 h-3.5 w-3.5" aria-hidden />}
            Re-score 50
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-8 text-xs"
            disabled={busy !== null}
            onClick={() => start("tag_only")}
          >
            {busy === "tag_only"
              ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden />
              : <Play className="mr-1.5 h-3.5 w-3.5" aria-hidden />}
            Tag-only smoke test
          </Button>
        </div>
      </div>

      {run && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <Badge variant={run.passed ? "default" : "destructive"} className="gap-1">
              {run.passed
                ? <CheckCircle2 className="h-3 w-3" aria-hidden />
                : <AlertTriangle className="h-3 w-3" aria-hidden />}
              {run.passed ? "Pass" : "Attention"}
            </Badge>
            <span className="text-muted-foreground">
              {run.mode === "tag_only" ? "tag-only" : "calibration"} · {run.checked} checked ·
              tolerance ±{run.tolerance}
            </span>
            {run.mode === "tag_only" && (
              <Badge variant="outline" className="text-[11px]">
                librosa calls: {run.librosa_calls_during_run}
              </Badge>
            )}
          </div>

          {run.note && <p className="text-xs text-muted-foreground">{run.note}</p>}

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
            {AXES.map((axis) => {
              const s = run.axis_summary?.[axis];
              const over = (s?.max_drift ?? 0) > run.tolerance;
              return (
                <div
                  key={axis}
                  className="rounded-lg border border-border/60 bg-background/40 p-2"
                >
                  <p className="truncate text-[11px] capitalize text-muted-foreground">{axis}</p>
                  <p className={`text-sm font-semibold ${over ? "text-destructive" : ""}`}>
                    {s ? s.mean_drift.toFixed(1) : "—"}
                  </p>
                  <p className="text-[10px] text-muted-foreground">
                    max {s ? s.max_drift.toFixed(1) : "—"} · n {s?.n ?? 0}
                  </p>
                </div>
              );
            })}
          </div>

          {offenders.length > 0 && (
            <ul className="space-y-1 text-xs">
              {offenders.slice(0, 8).map((d) => (
                <li
                  key={d.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded border border-destructive/40 bg-destructive/5 px-2 py-1"
                >
                  <span className="min-w-0 truncate">{d.name}</span>
                  <span className="text-muted-foreground">
                    {d.error ? d.error.slice(0, 80) : `drift ${d.max_drift?.toFixed(1)}`}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Card>
  );
};

export default ScoringRegressionPanel;
