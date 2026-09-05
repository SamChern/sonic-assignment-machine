import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Loader2, Layers, Bug, PlayCircle } from "lucide-react";
import { SOURCES, type Check, type Scope, type Status } from "@/lib/compatibilityReport";
import { STATUS_META } from "./statusMeta";

interface SourcesPanelProps {
  report: { checks: Check[] } | null;
  lastRun: Record<string, { at: string; debug: boolean; ms: number }>;
  running: boolean;
  runningScope: Scope | null;
  runningScopes: string[];
  selected: string[];
  setSelected: (updater: (prev: string[]) => string[]) => void;
  run: (scope: Scope, debug?: boolean) => void;
  runSelected: (debug?: boolean) => void;
}

export const SourcesPanel = ({
  report,
  lastRun,
  running,
  runningScope,
  runningScopes,
  selected,
  setSelected,
  run,
  runSelected,
}: SourcesPanelProps) => (
  <Card className="border-border/60 bg-card/60 p-5 backdrop-blur-sm">
    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
      <h2 className="text-sm font-semibold">Per-source tests</h2>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant="ghost"
          onClick={() =>
            setSelected((prev) =>
              prev.length === SOURCES.length ? [] : SOURCES.map((s) => s.scope),
            )
          }
          disabled={running}
        >
          {selected.length === SOURCES.length ? "Clear all" : "Select all"}
        </Button>
        <Button
          size="sm"
          onClick={() => runSelected(false)}
          disabled={running || selected.length === 0}
        >
          {running && runningScopes.length > 0 ? (
            <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
          ) : (
            <Layers className="mr-2 h-3.5 w-3.5" />
          )}
          Run selected in parallel ({selected.length})
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => runSelected(true)}
          disabled={running || selected.length === 0}
        >
          <Bug className="mr-2 h-3.5 w-3.5 text-primary" />
          Debug selected
        </Button>
      </div>
    </div>
    <ul className="space-y-2">
      {SOURCES.map((src) => {
        const feedChecks = report?.checks.filter((c) => c.feed === src.feed) ?? [];
        const worst: Status | null = feedChecks.length
          ? (["fail", "warn", "pass", "skip"] as Status[]).find((s) =>
              feedChecks.some((c) => c.status === s),
            ) ?? null
          : null;
        const last = lastRun[src.feed];
        const busy =
          running && (runningScope === src.scope || runningScopes.includes(src.scope));
        const isSelected = selected.includes(src.scope);
        return (
          <li
            key={src.scope}
            className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border/60 bg-background/40 p-3"
          >
            <div className="flex min-w-0 items-start gap-3">
              <Checkbox
                id={`sel-${src.scope}`}
                className="mt-0.5"
                checked={isSelected}
                disabled={running}
                onCheckedChange={(v) =>
                  setSelected((prev) =>
                    v ? [...prev, src.scope] : prev.filter((s) => s !== src.scope),
                  )
                }
              />
              <div className="min-w-0">

              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium">{src.label}</span>
                {worst && (
                  <Badge variant="outline" className={`text-[10px] ${STATUS_META[worst].className}`}>
                    {STATUS_META[worst].label}
                  </Badge>
                )}
                {last?.debug && (
                  <Badge variant="outline" className="text-[10px]">debug</Badge>
                )}
              </div>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {feedChecks.length
                  ? `${feedChecks.length} check(s)`
                  : "Not tested yet"}
                {last && ` · ran ${new Date(last.at).toLocaleTimeString()} in ${last.ms}ms`}
              </p>
              </div>
            </div>

            <div className="flex shrink-0 items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => run(src.scope)}
                disabled={running}
              >
                {busy ? (
                  <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                ) : (
                  <PlayCircle className="mr-2 h-3.5 w-3.5" />
                )}
                Run tests
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => run(src.scope, true)}
                disabled={running}
              >
                <Bug className="mr-2 h-3.5 w-3.5 text-primary" />
                Rerun with debug
              </Button>
            </div>
          </li>
        );
      })}
    </ul>
  </Card>
);
