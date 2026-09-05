/**
 * Renders the ordered list of pipeline stage cards on the Intuizi Console
 * page, including per-stage expand/collapse and the details drill-down.
 */
import { ChevronDown } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { HEALTH_META, relative, type Stage } from "@/pages/integrationStatus/stageModel";

interface StageTimelineProps {
  stages: Stage[];
  expandedStages: Record<string, boolean>;
  expanded: Record<string, boolean>;
  onToggleStage: (key: string) => void;
  onToggleDetails: (key: string) => void;
}

const StageTimeline = ({
  stages,
  expandedStages,
  expanded,
  onToggleStage,
  onToggleDetails,
}: StageTimelineProps) => {
  return (
    <ol className="space-y-4">
      {stages.map((stage, index) => {
        const meta = HEALTH_META[stage.health];
        const Icon = meta.icon;
        const stageOpen = !!expandedStages[stage.key];
        return (
          <li key={stage.key} className="relative pl-8">
            {index < stages.length - 1 && (
              <span
                aria-hidden
                className="absolute left-[11px] top-8 bottom-[-1rem] w-px bg-border"
              />
            )}
            <span className="absolute left-0 top-5 flex h-6 w-6 items-center justify-center rounded-full border border-border bg-card text-xs font-medium text-muted-foreground">
              {index + 1}
            </span>
            <Card className="p-5 space-y-3">
              <div className="flex items-start justify-between gap-4 flex-wrap">
                <div>
                  <h2 className="font-semibold">{stage.title}</h2>
                  <p className="text-sm text-muted-foreground">{stage.subtitle}</p>
                </div>
                <div className="flex flex-col items-end gap-2">
                  <div className="flex flex-wrap items-center justify-end gap-2">
                    <Badge variant="outline" className={`gap-1 ${meta.className}`}>
                      <Icon className="h-3 w-3" /> {meta.label}
                    </Badge>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-8 gap-1 text-xs"
                      onClick={() => onToggleStage(stage.key)}
                      aria-expanded={stageOpen}
                      aria-label={`${stageOpen ? "Collapse" : "Expand"} ${stage.title}`}
                    >
                      {stageOpen ? "Collapse" : "Expand"}
                      <ChevronDown className={`h-4 w-4 transition-transform ${stageOpen ? "rotate-180" : ""}`} />
                    </Button>
                  </div>
                  <span
                    className="text-xs text-muted-foreground"
                    title={stage.lastRunAt ? new Date(stage.lastRunAt).toLocaleString() : undefined}
                  >
                    Last run {relative(stage.lastRunAt)}
                  </span>
                </div>
              </div>

              {stageOpen && (
                <>
                  <div className="flex flex-wrap gap-x-6 gap-y-2">
                    {stage.metrics.map((m) => (
                      <div key={m.label}>
                        <p className="text-xs text-muted-foreground">{m.label}</p>
                        <p className="text-sm font-medium break-all">{m.value}</p>
                      </div>
                    ))}
                  </div>

                  {stage.note && (
                    <p className="text-xs text-muted-foreground border-t border-border pt-2">
                      {stage.note}
                    </p>
                  )}

                  <div className="border-t border-border pt-2">
                    <button
                      type="button"
                      onClick={() => onToggleDetails(stage.key)}
                      aria-expanded={!!expanded[stage.key]}
                      className="flex w-full items-center justify-between gap-2 text-sm font-medium text-primary hover:underline"
                    >
                      <span>
                        {stage.detailsLabel}
                        {stage.details.length ? ` (${stage.details.length})` : ""}
                      </span>
                      <ChevronDown
                        className={`h-4 w-4 transition-transform ${expanded[stage.key] ? "rotate-180" : ""}`}
                      />
                    </button>

                    {expanded[stage.key] && (
                      <div className="mt-3 space-y-2">
                        {stage.details.length === 0 ? (
                          <p className="text-xs text-muted-foreground">
                            No runs recorded for this stage yet.
                          </p>
                        ) : (
                          stage.details.map((row) => (
                            <div
                              key={row.id}
                              className="rounded-md border border-border bg-muted/30 p-3 space-y-1"
                            >
                              <div className="flex items-start justify-between gap-3 flex-wrap">
                                <p className="text-xs font-mono break-all">{row.title}</p>
                                {row.status && (
                                  <Badge variant="outline" className="text-xs shrink-0">
                                    {row.status}
                                  </Badge>
                                )}
                              </div>
                              <div className="flex flex-wrap gap-x-4 text-xs text-muted-foreground">
                                <span
                                  title={
                                    row.timestamp
                                      ? new Date(row.timestamp).toLocaleString()
                                      : undefined
                                  }
                                >
                                  {relative(row.timestamp)}
                                </span>
                                {row.meta && <span>{row.meta}</span>}
                              </div>
                              {row.error && (
                                <p className="text-xs text-destructive break-all font-mono">
                                  {row.error}
                                </p>
                              )}
                            </div>
                          ))
                        )}
                      </div>
                    )}
                  </div>
                </>
              )}
            </Card>
          </li>
        );
      })}
    </ol>
  );
};

export default StageTimeline;
