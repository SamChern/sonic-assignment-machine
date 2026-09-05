import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Layers } from "lucide-react";
import { STATUS_META } from "./statusMeta";
import { type ParallelResult } from "./types";

interface ParallelSummaryCardProps {
  parallel: {
    at: string;
    ms: number;
    debug: boolean;
    results: ParallelResult[];
  };
}

export const ParallelSummaryCard = ({ parallel }: ParallelSummaryCardProps) => (
  <Card className="border-border/60 bg-card/60 p-5 backdrop-blur-sm">
    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
      <h2 className="flex items-center gap-2 text-sm font-semibold">
        <Layers className="h-4 w-4 text-primary" />
        Parallel run summary
        {parallel.debug && (
          <Badge variant="outline" className="text-[10px]">debug</Badge>
        )}
      </h2>
      <span className="text-xs text-muted-foreground">
        {parallel.results.length} source(s) ·{" "}
        {new Date(parallel.at).toLocaleTimeString()} · wall {parallel.ms}ms
      </span>
    </div>
    <div className="overflow-x-auto">
      <table className="w-full text-left text-xs">
        <thead className="text-muted-foreground">
          <tr className="border-b border-border/60">
            <th className="py-2 pr-3 font-medium">Source</th>
            <th className="py-2 pr-3 font-medium">Result</th>
            <th className="py-2 pr-3 font-medium">Pass</th>
            <th className="py-2 pr-3 font-medium">Mismatch</th>
            <th className="py-2 pr-3 font-medium">Blocking</th>
            <th className="py-2 pr-3 font-medium">Skipped</th>
            <th className="py-2 font-medium">Latency</th>
          </tr>
        </thead>
        <tbody>
          {parallel.results.map((r) => (
            <tr key={r.scope} className="border-b border-border/40 last:border-0">
              <td className="py-2 pr-3 font-medium">{r.label}</td>
              <td className="py-2 pr-3">
                <Badge
                  variant="outline"
                  className={`text-[10px] ${
                    r.ok
                      ? STATUS_META[
                          r.counts?.fail ? "fail" : r.counts?.warn ? "warn" : "pass"
                        ].className
                      : STATUS_META.fail.className
                  }`}
                >
                  {r.ok ? r.counts?.verdict ?? "ok" : "error"}
                </Badge>
              </td>
              <td className="py-2 pr-3">{r.counts?.pass ?? "—"}</td>
              <td className="py-2 pr-3">{r.counts?.warn ?? "—"}</td>
              <td className="py-2 pr-3">{r.counts?.fail ?? "—"}</td>
              <td className="py-2 pr-3">{r.counts?.skip ?? "—"}</td>
              <td className="py-2">{r.ms}ms</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
    {parallel.results.some((r) => !r.ok) && (
      <ul className="mt-3 space-y-1 text-xs text-destructive">
        {parallel.results
          .filter((r) => !r.ok)
          .map((r) => (
            <li key={r.scope} className="break-words">
              <span className="font-medium">{r.label}:</span> {r.error}
            </li>
          ))}
      </ul>
    )}
  </Card>
);
