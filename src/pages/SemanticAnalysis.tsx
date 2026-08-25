import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";

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
import SpeechNormalizationPanel from "@/components/SpeechNormalizationPanel";
import CategoryFlipTrendWidget from "@/components/CategoryFlipTrendWidget";
import PerfMetricsBadge from "@/components/PerfMetricsBadge";
import { measurePerfSync, recordPageLoad, recordPerf } from "@/lib/perfMetrics";

import sonicSimLogo from "@/assets/SonicSIM_blend.png";


import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import {
  ArrowLeft,
  RefreshCw,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  CircleDashed,
  Layers,
  Radio,
  ChevronRight,
} from "lucide-react";

type StepState = "ok" | "pending" | "error";

interface IdentifierRow {
  id: string;
  primary_identifier: string;
  ctv_signals: Record<string, unknown> | null;
  apps_signals: Record<string, unknown> | null;
  visitation_signals: Record<string, unknown> | null;
  demographics_signals: Record<string, unknown> | null;
  origin_signals: Record<string, unknown> | null;
  tag_codes: string[] | null;
  audio_source_id: string | null;
  observation_count: number;
  last_seen_at: string | null;
  updated_at: string;
}

interface SourceRow {
  id: string;
  name: string;
  analysis_status: string;
  analysis_error: string | null;
  profile_embedding: unknown | null;
}

interface AnalysisRow {
  audio_source_id: string | null;
  category: string | null;
  confidence: number | null;
  created_at: string;
  emotional_score: number;
  cognitive_score: number;
  social_score: number;
  communication_score: number;
  contextual_score: number;
  artistic_score: number;
}

interface SavedAnalysis extends AnalysisRow {
  id: string;
  source_name: string;
}



const SAVED_PAGE_SIZE = 25;

const CATEGORY_KEYS = [
  ["emotional_score", "Emo", "bg-category-emotional", "var(--gradient-emotional)"],
  ["cognitive_score", "Cog", "bg-category-cognitive", "var(--gradient-cognitive)"],
  ["social_score", "Soc", "bg-category-social", "var(--gradient-social)"],
  ["communication_score", "Com", "bg-category-communication", "var(--gradient-communication)"],
  ["contextual_score", "Ctx", "bg-category-contextual", "var(--gradient-contextual)"],
  ["artistic_score", "Art", "bg-category-artistic", "var(--gradient-artistic)"],
] as const;

const CATEGORY_GRADIENTS: Record<string, string> = {
  emotional: "var(--gradient-emotional)",
  cognitive: "var(--gradient-cognitive)",
  social: "var(--gradient-social)",
  communication: "var(--gradient-communication)",
  contextual: "var(--gradient-contextual)",
  artistic: "var(--gradient-artistic)",
};

const relative = (iso: string | null) => {
  if (!iso) return "never";
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 48) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
};

const nonEmpty = (o: Record<string, unknown> | null | undefined) =>
  !!o && Object.keys(o).length > 0;

const ScoreBars = ({ ana }: { ana: AnalysisRow }) => (
  <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
    {CATEGORY_KEYS.map(([key, short, , gradient]) => {
      const value = Math.round(Number(ana[key]));
      return (
        <div key={key} className="flex items-center gap-2">
          <span className="w-8 shrink-0 text-[11px] font-medium text-muted-foreground">
            {short}
          </span>
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full transition-smooth"
              style={{ width: `${Math.max(2, Math.min(100, value))}%`, background: gradient }}
            />
          </div>
          <span className="w-7 shrink-0 text-right text-[11px] tabular-nums text-foreground/80">
            {value}
          </span>
        </div>
      );
    })}
  </div>
);

const StepPill = ({
  label,
  state,
  detail,
}: {
  label: string;
  state: StepState;
  detail: string;
}) => {
  const Icon =
    state === "ok" ? CheckCircle2 : state === "error" ? AlertTriangle : CircleDashed;
  const tone =
    state === "ok"
      ? "text-success border-success/40 bg-success/10 shadow-[0_0_20px_-8px_hsl(var(--success)/0.6)]"
      : state === "error"
        ? "text-destructive border-destructive/40 bg-destructive/10"
        : "text-muted-foreground border-border bg-muted/40";
  return (
    <div className={`rounded-lg border px-3 py-2 backdrop-blur-sm transition-smooth ${tone}`}>
      <div className="flex items-center gap-1.5 text-xs font-medium">
        <Icon className="h-3.5 w-3.5" />
        {label}
      </div>
      <p className="mt-0.5 text-[11px] opacity-80 break-all">{detail}</p>
    </div>
  );
};

type Stage = "all" | "normalized" | "linked" | "scored" | "failed";

const StatusDot = ({ state, title }: { state: StepState; title: string }) => (
  <span
    title={`${title}: ${state}`}
    aria-label={`${title}: ${state}`}
    className={`h-2 w-2 rounded-full ${
      state === "ok" ? "bg-success" : state === "error" ? "bg-destructive" : "bg-muted-foreground/50"
    }`}
  />
);

/** Per-identifier pipeline status, shared by the filter and the row renderer. */
function rowStatus(
  r: IdentifierRow,
  sources: Record<string, SourceRow>,
  analyses: Record<string, AnalysisRow>,
) {
  const signalGroups = [
    ["ctv", r.ctv_signals],
    ["apps", r.apps_signals],
    ["visitation", r.visitation_signals],
    ["demographics", r.demographics_signals],
    ["origin", r.origin_signals],
  ] as const;
  const present = signalGroups
    .filter(([, v]) => nonEmpty(v as Record<string, unknown>))
    .map(([k]) => k);
  const tags = r.tag_codes ?? [];
  const src = r.audio_source_id ? sources[r.audio_source_id] : undefined;
  const ana = r.audio_source_id ? analyses[r.audio_source_id] : undefined;

  const normState: StepState = present.length ? "ok" : "pending";
  const createState: StepState = !r.audio_source_id
    ? "pending"
    : src?.analysis_status === "failed"
      ? "error"
      : "ok";
  const scoreState: StepState = ana
    ? "ok"
    : src?.analysis_status === "failed"
      ? "error"
      : "pending";

  return { present, tags, src, ana, normState, createState, scoreState };
}


const SemanticAnalysis = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  // Activations exported from the Intuizi MCP console deep-link here.
  const activationParam = searchParams.get("activation")?.trim() || "5498";
  const { user, isAdmin, loading: authLoading } = useAuth();
  const [rows, setRows] = useState<IdentifierRow[]>([]);
  const [sources, setSources] = useState<Record<string, SourceRow>>({});
  const [analyses, setAnalyses] = useState<Record<string, AnalysisRow>>({});
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<IdentifierFilterState>({ ...EMPTY_IDENTIFIER_FILTER });
  const [stage, setStage] = useState<Stage>("all");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [saved, setSaved] = useState<SavedAnalysis[]>([]);
  const [selectedSavedId, setSelectedSavedId] = useState<string>("");
  const [savedTotal, setSavedTotal] = useState(0);
  const [savedLoading, setSavedLoading] = useState(false);
  const [savedQuery, setSavedQuery] = useState("");
  const savedQueryRef = useRef("");
  const savedCountRef = useRef(0);
  const scrollRef = useRef<HTMLDivElement>(null);



  useEffect(() => {
    if (!authLoading && (!user || !isAdmin)) navigate("/");
  }, [authLoading, user, isAdmin, navigate]);

  const load = useCallback(async () => {
    setLoading(true);
    const queryStart = performance.now();
    const { data: ids, error } = await supabase
      .from("intuizi_identifiers")
      .select(
        "id, primary_identifier, ctv_signals, apps_signals, visitation_signals, demographics_signals, origin_signals, tag_codes, audio_source_id, observation_count, last_seen_at, updated_at",
      )
      .order("updated_at", { ascending: false })
      .limit(100);

    if (error) {
      toast({
        title: "Could not load identifiers",
        description: error.message,
        variant: "destructive",
      });
      setLoading(false);
      return;
    }

    const identifiers = (ids ?? []) as unknown as IdentifierRow[];
    recordPerf("identifier.query", performance.now() - queryStart, identifiers.length);
    setRows(identifiers);

    const sourceIds = identifiers
      .map((r) => r.audio_source_id)
      .filter((v): v is string => !!v);

    if (sourceIds.length) {
      const [srcRes, anaRes] = await Promise.all([
        supabase
          .from("audio_sources")
          .select("id, name, analysis_status, analysis_error, profile_embedding")
          .in("id", sourceIds),
        supabase
          .from("source_analyses")
          .select(
            "audio_source_id, category, confidence, created_at, emotional_score, cognitive_score, social_score, communication_score, contextual_score, artistic_score",
          )
          .in("audio_source_id", sourceIds)
          .order("created_at", { ascending: false }),
      ]);

      const srcMap: Record<string, SourceRow> = {};
      for (const s of (srcRes.data ?? []) as unknown as SourceRow[]) srcMap[s.id] = s;
      setSources(srcMap);

      const anaMap: Record<string, AnalysisRow> = {};
      for (const a of (anaRes.data ?? []) as unknown as AnalysisRow[]) {
        if (a.audio_source_id && !anaMap[a.audio_source_id]) anaMap[a.audio_source_id] = a;
      }
      setAnalyses(anaMap);
    } else {
      setSources({});
      setAnalyses({});
    }
    setLoading(false);
  }, []);

  /** Most recent saved analyses (any source), paged + searchable. */
  const loadSaved = useCallback(async (append = false) => {
    const offset = append ? savedCountRef.current : 0;
    const q = savedQueryRef.current.trim();
    setSavedLoading(true);
    let query = supabase
      .from("source_analyses")
      .select(
        "id, source_name, audio_source_id, category, confidence, created_at, emotional_score, cognitive_score, social_score, communication_score, contextual_score, artistic_score",
        { count: "exact" },
      );
    // Date-looking queries (e.g. "2026-08" or "08/25") are matched client-side
    // against the timestamp; anything else narrows by source name server-side.
    const isDateQuery = /^[\d\-/:. ]+$/.test(q);
    if (q && !isDateQuery) query = query.ilike("source_name", `%${q}%`);

    const { data, error, count } = await query
      .order("created_at", { ascending: false })
      .range(offset, offset + SAVED_PAGE_SIZE - 1);
    setSavedLoading(false);


    if (error) {
      toast({
        title: "Could not load saved analyses",
        description: error.message,
        variant: "destructive",
      });
      return;
    }
    const page = (data ?? []) as unknown as SavedAnalysis[];
    setSavedTotal(count ?? 0);
    setSaved((prev) => {
      const list = append ? [...prev, ...page] : page;
      savedCountRef.current = list.length;
      return list;
    });
    setSelectedSavedId((prev) =>
      prev && (append || page.some((a) => a.id === prev)) ? prev : page[0]?.id ?? "",
    );
  }, []);


  useEffect(() => {
    if (isAdmin) load();
  }, [isAdmin, load]);


  /** Debounced server-side search on source name; resets paging. */
  useEffect(() => {
    if (!isAdmin) return;
    const t = setTimeout(() => {
      savedQueryRef.current = savedQuery;
      savedCountRef.current = 0;
      loadSaved();
    }, 300);
    return () => clearTimeout(t);
  }, [savedQuery, isAdmin, loadSaved]);


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
      <header className="sticky top-0 z-30 border-b border-border/60 bg-background/80 shadow-elegant backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3">
          <div className="flex min-w-0 items-center gap-2">
            <span
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg shadow-elegant"
              style={{ background: "var(--gradient-teal)" }}
            >
              <Radio className="h-4 w-4 text-primary-foreground" />
            </span>
            <h1
              className="truncate bg-clip-text text-base font-semibold text-transparent sm:text-lg"
              style={{ backgroundImage: "var(--gradient-teal)" }}
            >
              SonicSIM Analysis Results
            </h1>
          </div>

          <div className="ml-auto flex items-center gap-2">
            <img
              src={sonicSimLogo}
              alt="SonicSIM"
              width={1264}
              height={847}
              className="hidden h-6 w-auto max-w-[28vw] object-contain opacity-80 sm:block md:h-7"
              loading="lazy"
              decoding="async"
            />
            <Button variant="ghost" size="sm" onClick={() => navigate("/admin")}>
              <ArrowLeft className="mr-1 h-4 w-4" />
              Admin
            </Button>
            <Button variant="ghost" size="sm" onClick={() => navigate("/admin/pipeline")}>
              Intuizi Console
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                load();
                loadSaved();
              }}
              disabled={loading}
            >
              {loading ? (
                <Loader2 className="mr-1 h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="mr-1 h-4 w-4" />
              )}
              Refresh
            </Button>
          </div>
        </div>
      </header>


      <main className="relative mx-auto max-w-6xl px-4 py-6">
        <div className="grid gap-3 sm:grid-cols-4">
          {([
            ["Identifiers", totals.total, "var(--gradient-cognitive)"],
            ["Normalized", totals.normalized, "var(--gradient-contextual)"],
            ["Sources created", totals.created, "var(--gradient-social)"],
            ["Scored", totals.scored, "var(--gradient-artistic)"],
          ] as const).map(([label, value, gradient]) => (
            <Card
              key={label}
              className="relative overflow-hidden border-border/60 bg-card/70 p-4 backdrop-blur-sm transition-smooth hover:shadow-elegant"
            >
              <span
                aria-hidden
                className="absolute inset-x-0 top-0 h-1"
                style={{ background: gradient }}
              />
              <p className="text-xs text-muted-foreground">{label}</p>
              <p
                className="bg-clip-text text-3xl font-semibold text-transparent"
                style={{ backgroundImage: gradient }}
              >
                {value}
              </p>
            </Card>
          ))}
        </div>

        <Card className="mt-6 border-border/60 bg-card/70 p-4 backdrop-blur-sm">
          <div className="flex flex-wrap items-center gap-2">
            <Radio className="h-4 w-4 text-primary" />
            <h2 className="text-sm font-semibold">Latest saved analysis</h2>
            <div className="ml-auto w-full sm:w-80">
              <Select
                value={selectedSaved?.id ?? ""}
                onValueChange={setSelectedSavedId}
                disabled={!saved.length}
              >
                <SelectTrigger className="h-9">
                  <SelectValue
                    placeholder={saved.length ? "Select a saved analysis" : "No saved analyses yet"}
                  />
                </SelectTrigger>
                <SelectContent
                  className="max-h-72"
                  onScroll={(e) => {
                    const el = e.currentTarget;
                    if (
                      !savedLoading &&
                      saved.length < savedTotal &&
                      el.scrollTop + el.clientHeight >= el.scrollHeight - 24
                    ) {
                      loadSaved(true);
                    }
                  }}
                >
                  {saved.map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      {a.source_name} — {relative(a.created_at)}
                    </SelectItem>
                  ))}
                  {saved.length < savedTotal && (
                    <div className="px-2 py-2 text-center text-[11px] text-muted-foreground">
                      {savedLoading ? "Loading more…" : `Scroll for more (${saved.length}/${savedTotal})`}
                    </div>
                  )}
                </SelectContent>
              </Select>
            </div>
          </div>

          {selectedSaved ? (
            <div className="mt-3">
              <div className="flex flex-wrap items-center gap-2">
                <p className="truncate text-sm font-medium">{selectedSaved.source_name}</p>
                {selectedSaved.category && (
                  <Badge
                    variant="secondary"
                    className="text-[11px]"
                    style={{
                      backgroundImage:
                        CATEGORY_GRADIENTS[selectedSaved.category.toLowerCase()] ?? undefined,
                    }}
                  >
                    {selectedSaved.category}
                  </Badge>
                )}
                <span className="text-xs text-muted-foreground">
                  confidence {Math.round(Number(selectedSaved.confidence ?? 0) * 100)}% ·{" "}
                  {relative(selectedSaved.created_at)}
                </span>
              </div>
              <ScoreBars ana={selectedSaved} />
              {savedTotal > 0 && (
                <p className="mt-2 text-[11px] text-muted-foreground">
                  Showing {saved.length} of {savedTotal} saved analyses
                  {saved.length < savedTotal ? " — scroll the picker to load more." : "."}
                </p>
              )}
            </div>
          ) : (
            <div className="mt-4 rounded-lg border border-dashed border-border/70 bg-muted/20 p-5 text-center">
              <Radio className="mx-auto h-6 w-6 text-primary" />
              <p className="mt-2 text-sm font-semibold">No saved analyses yet</p>
              <p className="mx-auto mt-1 max-w-md text-xs text-muted-foreground">
                Nothing has been scored through the ontology so far. Run a data stream ingest to
                create the first activation profile, then its analysis will appear here
                automatically.
              </p>
              <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
                <Button
                  size="sm"
                  onClick={() =>
                    document
                      .getElementById("data-stream-wizard")
                      ?.scrollIntoView({ behavior: "smooth", block: "start" })
                  }
                >
                  Run a data stream ingest
                </Button>
                <Button variant="outline" size="sm" onClick={() => navigate("/admin/pipeline")}>
                  Open Intuizi Console
                </Button>
                <Button variant="ghost" size="sm" onClick={() => loadSaved()} disabled={savedLoading}>
                  Check again
                </Button>
              </div>
            </div>
          )}

        </Card>


        <div className="mt-6" id="data-stream-wizard">

          <PostIngestionWizard />
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

      </main>
    </div>
  );
};

export default SemanticAnalysis;
