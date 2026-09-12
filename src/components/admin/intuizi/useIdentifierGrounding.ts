/**
 * Per-device (identifier) grounding view for the Intuizi Console.
 *
 * The scoring queue holds millions of rows, so the RPC behind this hook works
 * off a bounded sample of the most recently touched rows for the chosen feed and
 * reports both the sample composition and the page of rows on screen.
 */
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export type GroundingFilter = "all" | "grounded" | "bridged" | "text-only";

export interface IdentifierRow {
  id: string;
  identifier: string;
  activation_id: string | null;
  report_type: string | null;
  status: string;
  attempts: number;
  last_error: string | null;
  updated_at: string;
  grounding_level: string;
  has_audio_embedding: boolean;
  confidence: number | null;
  scores: Record<string, number | null> | null;
  tag_labels: string[] | null;
}

export interface GroundingSummary {
  sampled: number;
  grounded: number;
  bridged: number;
  text_only: number;
  with_audio: number;
  with_scores: number;
  avg_confidence: number | null;
}

const PAGE_SIZE = 25;

export const useIdentifierGrounding = (sample = 500) => {
  const [rows, setRows] = useState<IdentifierRow[]>([]);
  const [summary, setSummary] = useState<GroundingSummary | null>(null);
  const [matched, setMatched] = useState(0);
  const [activationId, setActivationId] = useState<string>("");
  const [filter, setFilter] = useState<GroundingFilter>("all");
  const [scoredOnly, setScoredOnly] = useState(true);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [fetchedAt, setFetchedAt] = useState<Date | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const call = (size: number) =>
      supabase.rpc("admin_identifier_grounding", {
        _activation_id: activationId.trim() || null,
        _grounding: filter === "all" ? null : filter,
        _scored_only: scoredOnly,
        _sample: size,
        _limit: PAGE_SIZE,
        _offset: page * PAGE_SIZE,
      });

    let { data, error: rpcError } = await call(sample);
    // The queue is huge and the console runs several reports at once, so a busy
    // database can cut this one short. Retry once with a smaller sample.
    if (rpcError && /statement timeout|57014/i.test(rpcError.message)) {
      ({ data, error: rpcError } = await call(Math.min(sample, 150)));
    }
    if (rpcError) {
      setError(
        /statement timeout|57014/i.test(rpcError.message)
          ? "The database was too busy to build this sample. Try Refresh in a moment."
          : rpcError.message,
      );
      setRows([]);
    } else {
      const payload = (data ?? {}) as {
        rows?: IdentifierRow[];
        summary?: GroundingSummary;
        matched?: number;
      };
      setError(null);
      setRows(payload.rows ?? []);
      setSummary(payload.summary ?? null);
      setMatched(payload.matched ?? 0);
      setFetchedAt(new Date());
    }
    setLoading(false);
  }, [activationId, filter, scoredOnly, page, sample]);


  useEffect(() => {
    void load();
  }, [load]);

  const toggle = useCallback((id: string) => {
    setSelected((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }, []);

  const selectPage = useCallback(
    (on: boolean) => setSelected(on ? rows.map((r) => r.id) : []),
    [rows],
  );

  /** Put the chosen devices back in the queue, then nudge the worker. */
  const rescore = useCallback(
    async (forceFresh: boolean) => {
      if (!selected.length) return;
      setBusy(true);
      setNote(null);
      const { data, error: rpcError } = await supabase.rpc("admin_rescore_identifiers", {
        _ids: selected,
        _force_fresh: forceFresh,
      });
      if (rpcError) {
        setError(rpcError.message);
        setBusy(false);
        return;
      }
      const res = (data ?? {}) as { requeued?: number; cache_cleared?: number };
      const { error: fnErr } = await supabase.functions.invoke("intuizi-score-worker", {
        body: { source: "grounding-panel" },
      });
      setBusy(false);
      setSelected([]);
      setNote(
        `Queued ${(res.requeued ?? 0).toLocaleString()} device(s) for re-scoring${
          forceFresh ? `, discarding ${(res.cache_cleared ?? 0).toLocaleString()} saved result(s)` : ""
        }.${fnErr ? " The worker could not be started — it will pick them up on its next run." : " Scoring has started."}`,
      );
      await load();
    },
    [selected, load],
  );

  return {
    rows,
    summary,
    matched,
    activationId,
    setActivationId: (v: string) => {
      setPage(0);
      setSelected([]);
      setActivationId(v);
    },
    filter,
    setFilter: (v: GroundingFilter) => {
      setPage(0);
      setSelected([]);
      setFilter(v);
    },
    scoredOnly,
    setScoredOnly: (v: boolean) => {
      setPage(0);
      setSelected([]);
      setScoredOnly(v);
    },
    page,
    setPage,
    pageSize: PAGE_SIZE,
    loading,
    error,
    busy,
    note,
    selected,
    toggle,
    selectPage,
    rescore,
    reload: load,
    fetchedAt,
  };
};

export default useIdentifierGrounding;
