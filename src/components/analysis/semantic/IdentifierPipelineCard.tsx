import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ChevronRight, Layers } from "lucide-react";
import { IdentifierFilterBar, type FilterSegment } from "@/components/IdentifierFilterBar";
import PerfMetricsBadge from "@/components/PerfMetricsBadge";
import { ScoreBars } from "./ScoreBars";
import { StepPill } from "./StepPill";
import { StatusDot } from "./StatusDot";
import type { Virtualizer, VirtualItem } from "@tanstack/react-virtual";
import {
  AnalysisRow,
  CATEGORY_GRADIENTS,
  CATEGORY_KEYS,
  IdentifierRow,
  SourceRow,
  Stage,
  relative,
  rowStatus,
} from "@/lib/semanticAnalysis";
import type { IdentifierFilterState, TagOption } from "@/lib/identifierFilters";
import type { RefObject } from "react";

interface IdentifierPipelineCardProps {
  filter: IdentifierFilterState;
  setFilter: (v: IdentifierFilterState) => void;
  tagList: TagOption[];
  stageSegments: FilterSegment[];
  stage: Stage;
  setStage: (v: Stage) => void;
  filtered: IdentifierRow[];
  rows: IdentifierRow[];
  loading: boolean;
  scrollRef: RefObject<HTMLDivElement>;
  rowVirtualizer: Virtualizer<HTMLDivElement, Element>;
  virtualRows: VirtualItem[];
  expanded: string | null;
  setExpanded: (v: string | null) => void;
  sources: Record<string, SourceRow>;
  analyses: Record<string, AnalysisRow>;
}

export const IdentifierPipelineCard = ({
  filter,
  setFilter,
  tagList,
  stageSegments,
  stage,
  setStage,
  filtered,
  rows,
  loading,
  scrollRef,
  rowVirtualizer,
  virtualRows,
  expanded,
  setExpanded,
  sources,
  analyses,
}: IdentifierPipelineCardProps) => {
  return (
    <Card className="mt-6 border-border/60 bg-card/70 p-4 backdrop-blur-sm">
      <div className="mb-3 flex items-center gap-2">
        <Layers className="h-4 w-4 text-primary" />
        <h2 className="text-sm font-semibold">Identifier pipeline status</h2>
        <div className="ml-auto">
          <PerfMetricsBadge />
        </div>
      </div>
      <IdentifierFilterBar
        value={filter}
        onChange={(next) => {
          setFilter(next);
          setExpanded(null);
          scrollRef.current?.scrollTo({ top: 0 });
        }}
        tags={tagList}
        showBasis={false}
        segments={stageSegments}
        segmentValue={stage}
        onSegmentChange={(v) => {
          setStage(v as Stage);
          setExpanded(null);
          scrollRef.current?.scrollTo({ top: 0 });
        }}
        resultCount={filtered.length}
        totalCount={rows.length}
        placeholder="Search identifier or tag code…"
      />

      <div
        ref={scrollRef}
        className="mt-4 max-h-[560px] overflow-y-auto rounded-lg border border-border/60 bg-background/40"
      >
        {loading && rows.length === 0 && (
          <p className="p-4 text-sm text-muted-foreground">Loading identifiers…</p>
        )}
        {!loading && filtered.length === 0 && (
          <p className="p-4 text-sm text-muted-foreground">
            {rows.length === 0
              ? "No ingested identifiers yet. Once a delivery contains data rows, each identifier will appear here with its normalization, source creation, and scoring status."
              : "No identifiers match the current filters."}
          </p>
        )}

        {filtered.length > 0 && (
          <div className="relative w-full" style={{ height: rowVirtualizer.getTotalSize() }}>
            {virtualRows.map((virtualRow) => {
              const r = filtered[virtualRow.index];
              if (!r) return null;
              const st = rowStatus(r, sources, analyses);
              const { present, tags, normState, createState, scoreState, src, ana } = st;
              const catGradient = ana?.category
                ? CATEGORY_GRADIENTS[ana.category.toLowerCase()] ?? "var(--gradient-brand)"
                : "var(--gradient-brand)";
              const open = expanded === r.id;

              return (
                <div
                  key={virtualRow.key}
                  ref={rowVirtualizer.measureElement}
                  data-index={virtualRow.index}
                  className="absolute left-0 top-0 w-full border-b border-border/60"
                  style={{ transform: `translateY(${virtualRow.start}px)` }}
                >
                  <span
                    aria-hidden
                    className="absolute inset-y-0 left-0 w-0.5"
                    style={{ background: ana ? catGradient : "hsl(var(--border))" }}
                  />
                  <button
                    type="button"
                    onClick={() => setExpanded(open ? null : r.id)}
                    aria-expanded={open}
                    className="flex w-full items-center gap-2 px-3 py-2 pl-4 text-left transition-smooth hover:bg-muted/40"
                  >
                    <ChevronRight
                      className={`h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform ${open ? "rotate-90" : ""}`}
                    />
                    <span className="min-w-0 flex-1 truncate font-mono text-xs">
                      {r.primary_identifier}
                    </span>
                    <span className="hidden items-center gap-1 sm:flex">
                      <StatusDot state={normState} title="Normalization" />
                      <StatusDot state={createState} title="Source creation" />
                      <StatusDot state={scoreState} title="Scoring" />
                    </span>
                    {ana?.category && (
                      <Badge
                        className="hidden border-0 text-[10px] text-primary-foreground md:inline-flex"
                        style={{ background: catGradient }}
                      >
                        {ana.category}
                      </Badge>
                    )}
                    <span className="hidden text-[11px] text-muted-foreground lg:inline">
                      {tags.length} tag{tags.length === 1 ? "" : "s"} · {r.observation_count} obs
                    </span>
                    <span className="shrink-0 text-[11px] text-muted-foreground">
                      {relative(r.updated_at)}
                    </span>
                  </button>

                  {open && (
                    <div className="px-4 pb-4 pl-6">
                      {ana && <ScoreBars ana={ana} />}

                      <div className="mt-3 grid gap-2 md:grid-cols-3">
                        <StepPill
                          label="1. Normalization"
                          state={normState}
                          detail={
                            present.length
                              ? `signals: ${present.join(", ")} · ${tags.length} tag code${tags.length === 1 ? "" : "s"}`
                              : "no signal groups captured"
                          }
                        />
                        <StepPill
                          label="2. Source creation"
                          state={createState}
                          detail={
                            src
                              ? `${src.name} · ${src.analysis_status}${src.profile_embedding ? " · embedded" : ""}`
                              : "no audio source linked"
                          }
                        />
                        <StepPill
                          label="3. Scoring"
                          state={scoreState}
                          detail={
                            ana
                              ? `${CATEGORY_KEYS.map(([k, short]) => `${short} ${Math.round(Number(ana[k]))}`).join(" · ")} · conf ${Number(ana.confidence ?? 0).toFixed(2)}`
                              : src?.analysis_error || "awaiting analyze-audio"
                          }
                        />
                      </div>

                      {tags.length > 0 && (
                        <div className="mt-3 flex flex-wrap gap-1">
                          {tags.slice(0, 12).map((t) => (
                            <Badge key={t} variant="secondary" className="text-[11px]">
                              {t}
                            </Badge>
                          ))}
                          {tags.length > 12 && (
                            <Badge variant="secondary" className="text-[11px]">
                              +{tags.length - 12}
                            </Badge>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {filtered.length > 0 && (
        <p className="mt-2 text-center text-[11px] text-muted-foreground">
          Showing {virtualRows.length} of {filtered.length.toLocaleString()} rendered rows —
          scroll to load more instantly
        </p>
      )}
    </Card>
  );
};

export default IdentifierPipelineCard;
