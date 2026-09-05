import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { friendlyError } from "@/lib/friendlyError";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

import { IdentifierFilterBar, type FilterSegment } from "@/components/IdentifierFilterBar";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  EMPTY_IDENTIFIER_FILTER,
  matchesTags,
  matchesText,
  tagOptions,
  type IdentifierFilterState,
} from "@/lib/identifierFilters";
import { toast } from "@/hooks/use-toast";
import InspectMappingPanel from "@/components/InspectMappingPanel";
import PostIngestionWizard from "@/components/PostIngestionWizard";
import ConfidenceBreakdownPanel from "@/components/ConfidenceBreakdownPanel";
import ScoreQueueHealthPanel from "@/components/ScoreQueueHealthPanel";
import SpeechNormalizationPanel from "@/components/SpeechNormalizationPanel";
import CategoryFlipTrendWidget from "@/components/CategoryFlipTrendWidget";
import { measurePerfSync, recordPageLoad, recordPerf } from "@/lib/perfMetrics";

import sonicSimLogo from "@/assets/SonicSIM_blend.png";

import { Loader2 } from "lucide-react";

import SavedAnalysisDrawer from "@/components/SavedAnalysisDrawer";
import SemanticAnalysisHeader from "@/components/analysis/semantic/SemanticAnalysisHeader";
import SemanticAnalysisStats from "@/components/analysis/semantic/SemanticAnalysisStats";
import LatestSavedAnalysisCard from "@/components/analysis/semantic/LatestSavedAnalysisCard";
import IdentifierPipelineCard from "@/components/analysis/semantic/IdentifierPipelineCard";
import DeleteAnalysisDialog from "@/components/analysis/semantic/DeleteAnalysisDialog";
import { useSemanticAnalysisData } from "@/components/analysis/semantic/useSemanticAnalysisData";
import {
  AnalysisRow,
  DATE_PRESETS,
  IdentifierRow,
  SAVED_PAGE_SIZE,
  SORT_ORDER,
  SavedAnalysis,
  SavedSort,
  SourceRow,
  Stage,
  nonEmpty,
  relative,
  rowStatus,
} from "@/lib/semanticAnalysis";

const SemanticAnalysis = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  // Activations exported from the Intuizi MCP console deep-link here.
  const activationParam = searchParams.get("activation")?.trim() || "5498";
  const { user, isAdmin, loading: authLoading } = useAuth();
  const [filter, setFilter] = useState<IdentifierFilterState>({ ...EMPTY_IDENTIFIER_FILTER });
  const [stage, setStage] = useState<Stage>("all");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const {
    rows,
    sources,
    analyses,
    loading,
    load,
    saved,
    selectedSavedId,
    setSelectedSavedId,
    savedTotal,
    savedLoading,
    savedQuery,
    setSavedQuery,
    savedSort,
    setSavedSort,
    dateFrom,
    setDateFrom,
    dateTo,
    setDateTo,
    pendingDelete,
    setPendingDelete,
    deleting,
    deleteSaved,
    loadSaved,
    savedQueryRef,
    savedSortRef,
    savedRangeRef,
    savedCountRef,
  } = useSemanticAnalysisData(user?.id ?? null, () => setDrawerOpen(false));

  useEffect(() => {
    if (!authLoading && (!user || !isAdmin)) navigate("/");
  }, [authLoading, user, isAdmin, navigate]);

  const applyPreset = useCallback((days: number | null) => {
    if (days === null) {
      setDateFrom("");
      setDateTo("");
      return;
    }
    const now = new Date();
    const start = new Date(now.getTime() - (days - 1) * 86400000);
    setDateFrom(start.toISOString().slice(0, 10));
    setDateTo(now.toISOString().slice(0, 10));
  }, []);

  const activePreset = useMemo(() => {
    if (!dateFrom && !dateTo) return "All time";
    const today = new Date().toISOString().slice(0, 10);
    if (dateTo !== today) return null;
    for (const [label, days] of DATE_PRESETS) {
      if (days === null) continue;
      const start = new Date(Date.now() - (days - 1) * 86400000).toISOString().slice(0, 10);
      if (start === dateFrom) return label;
    }
    return null;
  }, [dateFrom, dateTo]);

  useEffect(() => {
    if (isAdmin) load();
  }, [isAdmin, load]);

  /** Debounced reload when search, sort or date range changes; resets paging. */
  useEffect(() => {
    if (!isAdmin) return;
    const t = setTimeout(() => {
      savedQueryRef.current = savedQuery;
      savedSortRef.current = savedSort;
      savedRangeRef.current = { from: dateFrom, to: dateTo };
      savedCountRef.current = 0;
      loadSaved();
    }, 300);
    return () => clearTimeout(t);
  }, [savedQuery, savedSort, dateFrom, dateTo, isAdmin, loadSaved]);

  const tagList = useMemo(() => tagOptions(rows.map((r) => r.tag_codes)), [rows]);

  const stageOf = useCallback(
    (r: IdentifierRow): Stage[] => {
      const st = rowStatus(r, sources, analyses);
      const stages: Stage[] = ["all"];
      if (st.normState === "ok") stages.push("normalized");
      if (st.createState === "ok") stages.push("linked");
      if (st.scoreState === "ok") stages.push("scored");
      if (st.createState === "error" || st.scoreState === "error") stages.push("failed");
      return stages;
    },
    [sources, analyses],
  );

  const filtered = useMemo(
    () =>
      measurePerfSync(
        "identifier.filter",
        () =>
          rows.filter(
            (r) =>
              stageOf(r).includes(stage) &&
              matchesTags(r.tag_codes, filter.tags) &&
              matchesText([r.primary_identifier, ...(r.tag_codes ?? [])], filter.text),
          ),
        (result) => result.length,
      ),
    [rows, stage, filter, stageOf],
  );

  // Row virtualization keeps the DOM at ~20 rows no matter how many
  // identifiers pass the filter (thousands of Intuizi devices per activation).
  const rowVirtualizer = useVirtualizer({
    count: filtered.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 37,
    overscan: 8,
    getItemKey: (index) => filtered[index]?.id ?? index,
  });

  const virtualRows = rowVirtualizer.getVirtualItems();

  // Render cost of the virtualized window: measured from the start of this
  // render pass to the browser's next paint-adjacent frame.
  const renderStart = performance.now();
  useEffect(() => {
    if (!filtered.length) return;
    const frame = requestAnimationFrame(() => {
      recordPerf("identifier.render", performance.now() - renderStart, virtualRows.length);
    });
    return () => cancelAnimationFrame(frame);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtered, virtualRows.length, expanded]);

  useEffect(() => {
    recordPageLoad();
  }, []);

  useEffect(() => {
    rowVirtualizer.measure();
  }, [expanded, rowVirtualizer]);

  const stageSegments: FilterSegment[] = useMemo(() => {
    const counts: Record<Stage, number> = {
      all: rows.length,
      normalized: 0,
      linked: 0,
      scored: 0,
      failed: 0,
    };
    for (const r of rows) {
      for (const s of stageOf(r)) if (s !== "all") counts[s] += 1;
    }
    return [
      { value: "all", label: "All", count: counts.all },
      { value: "normalized", label: "Normalized", count: counts.normalized },
      { value: "linked", label: "Linked", count: counts.linked },
      { value: "scored", label: "Scored", count: counts.scored },
      { value: "failed", label: "Failed", count: counts.failed },
    ];
  }, [rows, stageOf]);

  const totals = useMemo(() => {
    let normalized = 0;
    let created = 0;
    let scored = 0;
    for (const r of rows) {
      const hasSignals =
        nonEmpty(r.ctv_signals) ||
        nonEmpty(r.apps_signals) ||
        nonEmpty(r.visitation_signals) ||
        nonEmpty(r.demographics_signals) ||
        nonEmpty(r.origin_signals);
      if (hasSignals) normalized++;
      if (r.audio_source_id) created++;
      if (r.audio_source_id && analyses[r.audio_source_id]) scored++;
    }
    return { normalized, created, scored, total: rows.length };
  }, [rows, analyses]);

  /** Average of the loaded analyses — the live baseline for the preview panel. */
  const normalizationSample = useMemo(() => {
    const list = Object.values(analyses);
    if (!list.length) return { scores: null as null, label: undefined as string | undefined };
    const keys = [
      "emotional",
      "cognitive",
      "social",
      "communication",
      "contextual",
      "artistic",
    ] as const;
    const scores = {} as Record<(typeof keys)[number], number>;
    for (const k of keys) {
      scores[k] =
        list.reduce((s, a) => s + (Number(a[`${k}_score` as keyof AnalysisRow]) || 0), 0) /
        list.length;
    }
    return {
      scores,
      label: `avg of ${list.length} ingested analysis${list.length === 1 ? "" : "es"}`,
    };
  }, [analyses]);

  /** Loaded page filtered client-side so timestamps are searchable too. */
  const visibleSaved = useMemo(() => {
    const q = savedQuery.trim().toLowerCase();
    if (!q) return saved;
    return saved.filter((a) => {
      const stamp = a.created_at ?? "";
      return (
        (a.source_name ?? "").toLowerCase().includes(q) ||
        stamp.toLowerCase().includes(q) ||
        new Date(stamp).toLocaleString().toLowerCase().includes(q) ||
        relative(stamp).toLowerCase().includes(q)
      );
    });
  }, [saved, savedQuery]);

  const selectedSaved = useMemo(
    () => visibleSaved.find((a) => a.id === selectedSavedId) ?? visibleSaved[0] ?? null,
    [visibleSaved, selectedSavedId],
  );

  if (authLoading || !isAdmin) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="relative min-h-screen gradient-app">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-72 opacity-40 blur-3xl"
        style={{ background: "var(--gradient-brand)" }}
      />
      <SemanticAnalysisHeader
        navigate={navigate}
        loading={loading}
        onRefresh={() => {
          load();
          loadSaved();
        }}
      />

      <main className="relative mx-auto max-w-6xl px-4 py-6">
        <SemanticAnalysisStats totals={totals} />

        <LatestSavedAnalysisCard
          savedQuery={savedQuery}
          setSavedQuery={setSavedQuery}
          savedSort={savedSort}
          setSavedSort={setSavedSort}
          selectedSaved={selectedSaved}
          setSelectedSavedId={setSelectedSavedId}
          visibleSaved={visibleSaved}
          saved={saved}
          savedTotal={savedTotal}
          savedLoading={savedLoading}
          loadSaved={loadSaved}
          dateFrom={dateFrom}
          setDateFrom={setDateFrom}
          dateTo={dateTo}
          setDateTo={setDateTo}
          applyPreset={applyPreset}
          activePreset={activePreset}
          setDrawerOpen={setDrawerOpen}
          setPendingDelete={setPendingDelete}
          navigate={navigate}
        />

        <div className="mt-6" id="data-stream-wizard">
          <PostIngestionWizard />
        </div>

        <div className="mt-6">
          <ScoreQueueHealthPanel
            activationId={activationParam ?? undefined}
            className="border-border/60 bg-card/70 backdrop-blur-sm"
          />
        </div>

        <div className="mt-6">
          <ConfidenceBreakdownPanel defaultActivation={activationParam} />
        </div>

        <div className="mt-6">
          <SpeechNormalizationPanel
            sample={normalizationSample.scores}
            sampleLabel={normalizationSample.label}
          />
        </div>

        <div className="mt-6">
          <CategoryFlipTrendWidget />
        </div>

        <div className="mt-6">
          <InspectMappingPanel />
        </div>

        <IdentifierPipelineCard
          filter={filter}
          setFilter={setFilter}
          tagList={tagList}
          stageSegments={stageSegments}
          stage={stage}
          setStage={setStage}
          filtered={filtered}
          rows={rows}
          loading={loading}
          scrollRef={scrollRef}
          rowVirtualizer={rowVirtualizer}
          virtualRows={virtualRows}
          expanded={expanded}
          setExpanded={setExpanded}
          sources={sources}
          analyses={analyses}
        />
      </main>

      <SavedAnalysisDrawer
        analysis={selectedSaved}
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
      />

      <DeleteAnalysisDialog
        pendingDelete={pendingDelete}
        setPendingDelete={setPendingDelete}
        deleting={deleting}
        deleteSaved={deleteSaved}
      />
    </div>
  );
};

export default SemanticAnalysis;
