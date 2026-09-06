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
import {
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  GitCompare,
  Layers,
  Minus,
  TrendingUp,
} from "lucide-react";
import type { diffCategoryProfiles, compareCategoryProfiles, summarizeProfileImpact } from "@/lib/categoryProfile";
import type { SideOption } from "./types";

export const VersionDiffCard = ({
  compareMode,
  setCompareMode,
  changedRows,
  multiChangedCount,
  sideOptions,
  multiIds,
  toggleMultiId,
  orderedMultiIds,
  sideLabel,
  multiRows,
  leftId,
  setLeftId,
  rightId,
  setRightId,
  diffRows,
  impact,
  impactEnds,
}: {
  compareMode: "two" | "multi";
  setCompareMode: (m: "two" | "multi") => void;
  changedRows: ReturnType<typeof diffCategoryProfiles>;
  multiChangedCount: number;
  sideOptions: SideOption[];
  multiIds: string[];
  toggleMultiId: (id: string) => void;
  orderedMultiIds: string[];
  sideLabel: (id: string) => string;
  multiRows: ReturnType<typeof compareCategoryProfiles>;
  leftId: string;
  setLeftId: (id: string) => void;
  rightId: string;
  setRightId: (id: string) => void;
  diffRows: ReturnType<typeof diffCategoryProfiles>;
  impact: ReturnType<typeof summarizeProfileImpact> | null;
  impactEnds: { from: string; to: string } | null;
}) => {
  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-center gap-2">
        <GitCompare className="h-4 w-4 text-primary" />
        <h3 className="text-sm font-semibold">Version diff</h3>
        <Badge variant="outline" className="text-[11px]">
          {compareMode === "two" ? changedRows.length : multiChangedCount} of 6 categories changed
        </Badge>
        <div className="ml-auto flex gap-1">
          <Button
            size="sm"
            variant={compareMode === "two" ? "default" : "outline"}
            onClick={() => setCompareMode("two")}
          >
            Two-way
          </Button>
          <Button
            size="sm"
            variant={compareMode === "multi" ? "default" : "outline"}
            onClick={() => setCompareMode("multi")}
          >
            <Layers className="mr-1 h-4 w-4" />
            Multi-version
          </Button>
        </div>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        {compareMode === "two"
          ? "Compare any two calibrations side by side — renamed categories, weight and match-influence shifts, calibration offsets, and anything muted or re-enabled."
          : "Pick three or more calibrations to see the full timeline. Each column is highlighted where it differs from the column before it."}
      </p>

      {compareMode === "multi" ? (
        <div className="mt-3 space-y-3">
          <div className="flex flex-wrap gap-1.5">
            {sideOptions.map((o) => {
              const on = multiIds.includes(o.id);
              return (
                <button
                  key={`m-${o.id}`}
                  type="button"
                  onClick={() => toggleMultiId(o.id)}
                  className={`rounded-full border px-2.5 py-1 text-[11px] transition-colors ${
                    on
                      ? "border-primary bg-primary/15 text-primary"
                      : "border-border/60 text-muted-foreground hover:border-primary/40"
                  }`}
                >
                  {o.label}
                </button>
              );
            })}
          </div>

          {orderedMultiIds.length < 2 ? (
            <p className="rounded-lg border border-dashed border-border/60 p-4 text-center text-xs text-muted-foreground">
              Select at least two calibrations to compare.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <div
                className="min-w-[560px] space-y-2"
                style={{ ["--cols" as string]: orderedMultiIds.length }}
              >
                <div
                  className="grid gap-2 px-2 text-[11px] font-medium text-muted-foreground"
                  style={{
                    gridTemplateColumns: `140px repeat(${orderedMultiIds.length}, minmax(0,1fr))`,
                  }}
                >
                  <span>Category</span>
                  {orderedMultiIds.map((id) => (
                    <span key={`h-${id}`} className="truncate">
                      {sideLabel(id)}
                    </span>
                  ))}
                </div>

                {multiRows.map((r) => (
                  <div
                    key={r.key}
                    className={`rounded-lg border p-3 ${
                      r.changed ? "border-primary/40 bg-primary/5" : "border-border/40 bg-muted/10"
                    }`}
                  >
                    <div
                      className="grid gap-2"
                      style={{
                        gridTemplateColumns: `140px repeat(${orderedMultiIds.length}, minmax(0,1fr))`,
                      }}
                    >
                      <div className="min-w-0">
                        <p className="font-mono text-[11px] text-muted-foreground">{r.key}</p>
                        <span className="text-[11px] text-muted-foreground">
                          {r.changed
                            ? `${r.changeCount} change${r.changeCount === 1 ? "" : "s"}`
                            : "unchanged"}
                        </span>
                      </div>
                      {r.cells.map((cell, i) => (
                        <div
                          key={`${r.key}-${orderedMultiIds[i]}`}
                          className={`space-y-0.5 rounded-md p-2 text-[11px] ${
                            cell.changedFromPrev ? "bg-primary/10 ring-1 ring-primary/30" : ""
                          }`}
                        >
                          <p className={cell.labelChanged ? "font-medium text-primary" : ""}>
                            {cell.setting.label}
                          </p>
                          <p className={cell.weightChanged ? "font-medium text-primary" : ""}>
                            ×{cell.setting.weight.toFixed(1)} ·{" "}
                            {(cell.influence * 100).toFixed(0)}%
                          </p>
                          <p className={cell.biasChanged ? "font-medium text-primary" : ""}>
                            shift {cell.setting.bias > 0 ? "+" : ""}
                            {cell.setting.bias.toFixed(0)} pts
                          </p>
                          <p className={cell.enabledChanged ? "font-medium text-primary" : ""}>
                            {cell.setting.enabled ? "active" : "muted"}
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      ) : (
      <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_auto_1fr] sm:items-center">
        <Select value={leftId} onValueChange={setLeftId}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {sideOptions.map((o) => (
              <SelectItem key={`l-${o.id}`} value={o.id}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <ArrowRight className="mx-auto hidden h-4 w-4 text-muted-foreground sm:block" />
        <Select value={rightId} onValueChange={setRightId}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {sideOptions.map((o) => (
              <SelectItem key={`r-${o.id}`} value={o.id}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      )}


      {compareMode === "multi" ? null : !changedRows.length ? (
        <p className="mt-4 rounded-lg border border-dashed border-border/60 p-4 text-center text-xs text-muted-foreground">
          {sideLabel(leftId)} and {sideLabel(rightId)} are identical across all 6 categories.
        </p>
      ) : (
        <div className="mt-4 space-y-2">
          <div className="hidden grid-cols-[1fr_1fr_1fr] gap-2 px-2 text-[11px] font-medium text-muted-foreground sm:grid">
            <span>Category</span>
            <span className="truncate">{sideLabel(leftId)}</span>
            <span className="truncate">{sideLabel(rightId)}</span>
          </div>
          {diffRows.map((r) => (
            <div
              key={r.key}
              className={`rounded-lg border p-3 ${
                r.changed ? "border-primary/40 bg-primary/5" : "border-border/40 bg-muted/10"
              }`}
            >
              <div className="grid gap-2 sm:grid-cols-[1fr_1fr_1fr]">
                <div className="min-w-0">
                  <p className="text-xs font-medium">{r.right.label}</p>
                  <p className="font-mono text-[11px] text-muted-foreground">{r.key}</p>
                  {!r.changed && (
                    <span className="text-[11px] text-muted-foreground">unchanged</span>
                  )}
                </div>

                {(["left", "right"] as const).map((side) => {
                  const s = side === "left" ? r.left : r.right;
                  const influence = side === "left" ? r.leftInfluence : r.rightInfluence;
                  return (
                    <div key={side} className="space-y-1 text-[11px]">
                      <p className="sm:hidden text-muted-foreground">
                        {sideLabel(side === "left" ? leftId : rightId)}
                      </p>
                      <p className={r.labelChanged ? "font-medium text-primary" : ""}>
                        name: {s.label}
                      </p>
                      <p className={r.weightChanged ? "font-medium text-primary" : ""}>
                        weight ×{s.weight.toFixed(1)} · {(influence * 100).toFixed(0)}% of match
                      </p>
                      <p className={r.biasChanged ? "font-medium text-primary" : ""}>
                        shift {s.bias > 0 ? "+" : ""}
                        {s.bias.toFixed(0)} pts
                      </p>
                      <p className={r.enabledChanged ? "font-medium text-primary" : ""}>
                        {s.enabled ? "active" : "muted"}
                      </p>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {impact && (
        <div className="mt-4 rounded-lg border border-primary/30 bg-primary/5 p-3">
          <div className="flex flex-wrap items-center gap-2">
            <TrendingUp className="h-4 w-4 text-primary" />
            <h4 className="text-xs font-semibold">Impact on Predict SonicSIM-Users</h4>
            <Badge
              variant={impact.severity === "none" ? "outline" : "secondary"}
              className="text-[10px] capitalize"
            >
              {impact.severity === "none" ? "no impact" : `${impact.severity} impact`}
            </Badge>
            <span className="ml-auto text-[11px] text-muted-foreground">
              {sideLabel(impactEnds!.from)} → {sideLabel(impactEnds!.to)}
            </span>
          </div>

          <p className="mt-2 text-xs">{impact.headline}</p>

          <div className="mt-2 flex items-center gap-2">
            <div className="h-1.5 flex-1 overflow-hidden rounded bg-muted">
              <div className="h-full bg-primary" style={{ width: `${impact.magnitude}%` }} />
            </div>
            <span className="w-32 text-right text-[11px] text-muted-foreground">
              {impact.magnitude}/100 expected shuffle
            </span>
          </div>

          {impact.points.length > 0 && (
            <ul className="mt-3 space-y-1.5">
              {impact.points.map((p, i) => (
                <li key={i} className="flex gap-2 text-[11px] text-muted-foreground">
                  {p.direction === "up" ? (
                    <ArrowUpRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
                  ) : p.direction === "down" ? (
                    <ArrowDownRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" />
                  ) : (
                    <Minus className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  )}
                  <span>{p.text}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Card>
  );
};
