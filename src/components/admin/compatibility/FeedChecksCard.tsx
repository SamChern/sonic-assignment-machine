import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, RefreshCw, Bug, ChevronDown, Wrench } from "lucide-react";
import { type Check, type Scope, scopeForFeed } from "@/lib/compatibilityReport";
import { STATUS_META } from "./statusMeta";

interface FeedChecksCardProps {
  feed: string;
  checks: Check[];
  running: boolean;
  runningScope: Scope | null;
  open: Record<string, boolean>;
  setOpen: (updater: (prev: Record<string, boolean>) => Record<string, boolean>) => void;
  run: (scope: Scope, debug?: boolean) => void;
}

export const FeedChecksCard = ({ feed, checks, running, runningScope, open, setOpen, run }: FeedChecksCardProps) => (
  <Card className="border-border/60 bg-card/60 p-5 backdrop-blur-sm">
    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
        {feed}
      </h2>
      <div className="flex items-center gap-1">
        <Button
          size="sm"
          variant="outline"
          onClick={() => run(scopeForFeed(feed))}
          disabled={running}
        >
          {running && runningScope === scopeForFeed(feed) ? (
            <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
          ) : (
            <RefreshCw className="mr-2 h-3.5 w-3.5" />
          )}
          Run tests
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => run(scopeForFeed(feed), true)}
          disabled={running}
        >
          <Bug className="mr-2 h-3.5 w-3.5 text-primary" />
          Rerun with debug
        </Button>
      </div>
    </div>
    <ul className="space-y-2">
      {checks.map((c) => {
        const meta = STATUS_META[c.status];
        const Icon = meta.icon;
        const isOpen = !!open[c.id];
        const hasDetail = !!(c.expected || c.actual || c.remediation || c.evidence || c.debug);
        return (
          <li key={c.id} className="rounded-lg border border-border/60 bg-background/40">
            <button
              type="button"
              className="flex w-full items-start gap-3 p-3 text-left"
              onClick={() => setOpen((p) => ({ ...p, [c.id]: !p[c.id] }))}
            >
              <Icon
                className={`mt-0.5 h-4 w-4 shrink-0 ${
                  c.status === "pass"
                    ? "text-primary"
                    : c.status === "warn"
                    ? "text-amber-500"
                    : c.status === "fail"
                    ? "text-destructive"
                    : "text-muted-foreground"
                }`}
              />
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium">{c.title}</span>
                  <Badge variant="outline" className={`text-[10px] ${meta.className}`}>
                    {meta.label}
                  </Badge>
                </span>
                <span className="mt-1 block break-words text-xs text-muted-foreground">
                  {c.detail}
                </span>
              </span>
              {hasDetail && (
                <ChevronDown
                  className={`mt-0.5 h-4 w-4 shrink-0 text-muted-foreground transition-transform ${
                    isOpen ? "rotate-180" : ""
                  }`}
                />
              )}
            </button>

            {isOpen && hasDetail && (
              <div className="space-y-2 border-t border-border/60 p-3 text-xs">
                {c.expected && (
                  <div>
                    <span className="font-medium text-muted-foreground">Expected: </span>
                    <span className="break-words font-mono">{c.expected}</span>
                  </div>
                )}
                {c.actual && (
                  <div>
                    <span className="font-medium text-muted-foreground">Actual: </span>
                    <span className="break-words font-mono">{c.actual}</span>
                  </div>
                )}
                {c.remediation && (
                  <div className="rounded-md border border-primary/30 bg-primary/5 p-2">
                    <span className="flex items-center gap-1 font-medium text-primary">
                      <Wrench className="h-3 w-3" /> Remediation
                    </span>
                    <p className="mt-1 break-words text-muted-foreground">{c.remediation}</p>
                  </div>
                )}
                {c.evidence && (
                  <pre className="max-h-40 overflow-auto rounded-md bg-muted/40 p-2 font-mono text-[10px] leading-relaxed">
                    {JSON.stringify(c.evidence, null, 2)}
                  </pre>
                )}
                {c.debug && (
                  <div className="rounded-md border border-primary/20 bg-primary/5 p-2">
                    <span className="flex items-center gap-1 font-medium text-primary">
                      <Bug className="h-3 w-3" /> Debug
                    </span>
                    <pre className="mt-1 max-h-56 overflow-auto font-mono text-[10px] leading-relaxed">
                      {JSON.stringify(c.debug, null, 2)}
                    </pre>
                  </div>
                )}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  </Card>
);
