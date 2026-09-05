import { useCallback, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { friendlyError } from "@/lib/friendlyError";
import { toast } from "@/hooks/use-toast";
import { recordPerf } from "@/lib/perfMetrics";
import {
  AnalysisRow,
  IdentifierRow,
  SAVED_PAGE_SIZE,
  SORT_ORDER,
  SavedAnalysis,
  SavedSort,
  SourceRow,
} from "@/lib/semanticAnalysis";

/**
 * Owns the two data sources behind the Semantic Analysis page: the recent
 * identifier pipeline rows, and the paged/searchable saved-analysis list
 * (plus its delete flow). Kept separate from rendering so the page stays
 * focused on layout.
 */
export function useSemanticAnalysisData(userId: string | null, onDeleted?: () => void) {
  const [rows, setRows] = useState<IdentifierRow[]>([]);
  const [sources, setSources] = useState<Record<string, SourceRow>>({});
  const [analyses, setAnalyses] = useState<Record<string, AnalysisRow>>({});
  const [loading, setLoading] = useState(true);

  const [saved, setSaved] = useState<SavedAnalysis[]>([]);
  const [selectedSavedId, setSelectedSavedId] = useState<string>("");
  const [savedTotal, setSavedTotal] = useState(0);
  const [savedLoading, setSavedLoading] = useState(false);
  const [savedQuery, setSavedQuery] = useState("");
  const [savedSort, setSavedSort] = useState<SavedSort>("newest");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [pendingDelete, setPendingDelete] = useState<SavedAnalysis | null>(null);
  const [deleting, setDeleting] = useState(false);
  const savedQueryRef = useRef("");
  const savedSortRef = useRef<SavedSort>("newest");
  const savedRangeRef = useRef({ from: "", to: "" });
  const savedCountRef = useRef(0);
  // Kept in a ref so loadSaved stays a stable callback while still scoping the
  // query to this account (see the user_id filter below).
  const userIdRef = useRef<string | null>(null);
  userIdRef.current = userId;

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
        description: friendlyError(error),
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

  /** Saved analyses — paged, searchable, sortable and date-bounded. */
  const loadSaved = useCallback(async (append = false) => {
    const offset = append ? savedCountRef.current : 0;
    const q = savedQueryRef.current.trim();
    const sort = savedSortRef.current;
    const { from, to } = savedRangeRef.current;
    setSavedLoading(true);
    // Two things used to make this query time out for admins: the admin RLS
    // policy makes every one of the ~750k Intuizi analyses visible, and
    // `count: "exact"` forced a full scan on top of the sort. Scoping to this
    // account hits idx_source_analyses_user_created, and the total is derived
    // from paging instead of a counting scan.
    let query = supabase
      .from("source_analyses")
      .select(
        "id, source_name, audio_source_id, category, confidence, created_at, emotional_score, cognitive_score, social_score, communication_score, contextual_score, artistic_score",
      );
    if (userIdRef.current) query = query.eq("user_id", userIdRef.current);
    // Date-looking queries (e.g. "2026-08" or "08/25") are matched client-side
    // against the timestamp; anything else narrows by source name server-side.
    const isDateQuery = /^[\d\-/:. ]+$/.test(q);
    if (q && !isDateQuery) query = query.ilike("source_name", `%${q}%`);
    if (from) query = query.gte("created_at", new Date(`${from}T00:00:00`).toISOString());
    if (to) query = query.lte("created_at", new Date(`${to}T23:59:59.999`).toISOString());

    const [column, ascending] = SORT_ORDER[sort];
    // One extra row tells us whether another page exists without a count query.
    const { data, error } = await query
      .order(column, { ascending })
      .range(offset, offset + SAVED_PAGE_SIZE);
    setSavedLoading(false);

    if (error) {
      toast({
        title: "Could not load saved analyses",
        description: friendlyError(error),
        variant: "destructive",
      });
      return;
    }
    const rawPage = (data ?? []) as unknown as SavedAnalysis[];
    const hasMore = rawPage.length > SAVED_PAGE_SIZE;
    const page = hasMore ? rawPage.slice(0, SAVED_PAGE_SIZE) : rawPage;
    setSavedTotal(offset + page.length + (hasMore ? 1 : 0));

    setSaved((prev) => {
      const list = append ? [...prev, ...page] : page;
      savedCountRef.current = list.length;
      return list;
    });
    setSelectedSavedId((prev) =>
      prev && (append || page.some((a) => a.id === prev)) ? prev : page[0]?.id ?? "",
    );
  }, []);

  /** Remove a saved analysis, then refresh the list immediately. */
  const deleteSaved = useCallback(async () => {
    const target = pendingDelete;
    if (!target) return;
    setDeleting(true);
    const { error } = await supabase.from("source_analyses").delete().eq("id", target.id);
    setDeleting(false);
    if (error) {
      toast({
        title: "Could not delete analysis",
        description: friendlyError(error),
        variant: "destructive",
      });
      return;
    }
    setPendingDelete(null);
    onDeleted?.();
    setSaved((prev) => {
      const list = prev.filter((a) => a.id !== target.id);
      savedCountRef.current = list.length;
      return list;
    });
    setSavedTotal((t) => Math.max(0, t - 1));
    setSelectedSavedId((prev) => (prev === target.id ? "" : prev));
    toast({ title: "Analysis deleted", description: target.source_name });
    savedCountRef.current = 0;
    loadSaved();
  }, [pendingDelete, loadSaved]);

  return {
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
  };
}
