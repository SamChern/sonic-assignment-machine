import { useEffect, useState } from "react";
import { Activity, Bug, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Badge } from "@/components/ui/badge";
import {
  PERF_LABELS,
  isPerfDebug,
  perfStats,
  recordPageLoad,
  resetPerf,
  setPerfDebug,
  subscribePerf,
  type PerfMetric,
} from "@/lib/perfMetrics";
import { cn } from "@/lib/utils";

const TRACKED: PerfMetric[] = [
  "identifier.query",
  "identifier.filter",
  "identifier.render",
  "page.load",
];

const fmt = (ms: number) => (ms >= 1000 ? `${(ms / 1000).toFixed(2)}s` : `${Math.round(ms)}ms`);

/** Green under 16ms (one frame), amber under 100ms, red beyond. */
function tone(metric: PerfMetric, ms: number) {
  const budget = metric === "page.load" ? 2500 : metric === "identifier.query" ? 600 : 16;
  if (ms <= budget) return "text-success";
  if (ms <= budget * 3) return "text-amber-400";
  return "text-destructive";
}

/**
 * Compact performance readout for the identifier surfaces. Samples are kept in
 * memory by `perfMetrics`, so this adds no network calls — it just surfaces how
 * query, filter, and render timings trend as the dataset grows.
 */
export function PerfMetricsBadge({ className }: { className?: string }) {
  const [, bump] = useState(0);
  const [debug, setDebug] = useState(isPerfDebug());

  useEffect(() => {
    recordPageLoad();
    return subscribePerf(() => bump((n) => n + 1));
  }, []);

  const stats = perfStats(TRACKED);
  const filter = stats.find((s) => s.metric === "identifier.filter");
  const headline = filter ?? stats[0];

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className={cn("h-8 gap-1.5 px-2 text-xs", className)}
          aria-label="Performance metrics"
        >
          <Activity className="h-3.5 w-3.5 text-primary" />
          <span className="hidden sm:inline">Perf</span>
          {headline && (
            <span className={cn("font-mono", tone(headline.metric, headline.last))}>
              {fmt(headline.last)}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 bg-popover p-3" align="end">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-sm font-semibold">Identifier performance</h3>
          <Badge variant="secondary" className="text-[10px]">
            in-memory
          </Badge>
        </div>

        {stats.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            No samples yet — load or filter identifiers to collect timings.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-[10px] uppercase tracking-wide text-muted-foreground">
                  <th className="pb-1 font-medium">Stage</th>
                  <th className="pb-1 text-right font-medium">Last</th>
                  <th className="pb-1 text-right font-medium">p50</th>
                  <th className="pb-1 text-right font-medium">p95</th>
                  <th className="pb-1 text-right font-medium">n</th>
                </tr>
              </thead>
              <tbody className="font-mono">
                {stats.map((s) => (
                  <tr key={s.metric} className="border-t border-border/50">
                    <td className="py-1 font-sans">
                      {PERF_LABELS[s.metric]}
                      {s.lastCount !== undefined && (
                        <span className="ml-1 text-[10px] text-muted-foreground">
                          {s.lastCount.toLocaleString()} rows
                        </span>
                      )}
                    </td>
                    <td className={cn("py-1 text-right", tone(s.metric, s.last))}>{fmt(s.last)}</td>
                    <td className="py-1 text-right text-muted-foreground">{fmt(s.p50)}</td>
                    <td className="py-1 text-right text-muted-foreground">{fmt(s.p95)}</td>
                    <td className="py-1 text-right text-muted-foreground">{s.samples}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="mt-3 flex items-center justify-between gap-2">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 gap-1 px-2 text-xs"
            onClick={() => {
              const next = !debug;
              setPerfDebug(next);
              setDebug(next);
            }}
          >
            <Bug className={cn("h-3 w-3", debug && "text-primary")} />
            Console logging {debug ? "on" : "off"}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 gap-1 px-2 text-xs"
            onClick={() => resetPerf()}
          >
            <RotateCcw className="h-3 w-3" />
            Reset
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

export default PerfMetricsBadge;
