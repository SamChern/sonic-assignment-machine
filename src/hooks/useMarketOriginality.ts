import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  compareToMarket,
  describeCohort,
  type CohortStat,
  type MarketBaseline,
  type MarketMetric,
  type MarketOriginality,
  type TrackMeasurements,
} from "@/lib/marketOriginality";

/** Sources we treat as "real market": commercially released catalogues only. */
const MARKET_SOURCE_TYPES = ["spotify", "apple", "apple_music"];

interface MusicalScoresRow {
  pitch?: number | null;
  rhythm?: number | null;
  timbre?: number | null;
  musicality?: number | null;
  notes?: { tempo_bpm?: number | null } | null;
}

const readMeasurements = (raw: unknown): TrackMeasurements | null => {
  const m = raw as MusicalScoresRow | null;
  if (!m || typeof m !== "object") return null;
  const pitch = Number(m.pitch);
  if (!Number.isFinite(pitch)) return null;
  return {
    pitch,
    rhythm: Number.isFinite(Number(m.rhythm)) ? Number(m.rhythm) : null,
    timbre: Number.isFinite(Number(m.timbre)) ? Number(m.timbre) : null,
    tempo_bpm: Number.isFinite(Number(m.notes?.tempo_bpm)) ? Number(m.notes?.tempo_bpm) : null,
  };
};

/**
 * Market originality for a set of audio sources.
 *
 * Loads the published market baselines plus a live cohort measured from
 * commercially released audio in the platform, then compares each requested
 * source's musical read against it.
 */
export function useMarketOriginality(sourceIds: string[]) {
  const [baselines, setBaselines] = useState<MarketBaseline[]>([]);
  const [cohort, setCohort] = useState<Partial<Record<MarketMetric, CohortStat>>>({});
  const [measured, setMeasured] = useState<Map<string, TrackMeasurements>>(new Map());
  const [loading, setLoading] = useState(false);

  const key = useMemo(() => [...new Set(sourceIds.filter(Boolean))].sort().join(","), [sourceIds]);
  const lastKey = useRef<string>("");

  const load = useCallback(async () => {
    const ids = key ? key.split(",") : [];
    setLoading(true);
    try {
      const [baseRes, marketRes, mineRes] = await Promise.all([
        supabase
          .from("market_baselines")
          .select("market, market_label, metric, mean, stddev, sample_size, unit, source_note")
          .eq("market", "commercial_release"),
        supabase
          .from("source_analyses")
          .select("musical_scores, audio_sources!inner(source_type)")
          .not("musical_scores", "is", null)
          .in("audio_sources.source_type", MARKET_SOURCE_TYPES)
          .limit(1000),
        ids.length
          ? supabase
              .from("source_analyses")
              .select("audio_source_id, musical_scores, created_at")
              .in("audio_source_id", ids)
              .not("musical_scores", "is", null)
              .order("created_at", { ascending: false })
              .limit(1000)
          : Promise.resolve({ data: [], error: null }),
      ]);

      setBaselines((baseRes.data ?? []) as unknown as MarketBaseline[]);

      const buckets: Record<MarketMetric, number[]> = {
        pitch: [],
        rhythm: [],
        timbre: [],
        tempo_bpm: [],
        loudness_db: [],
      };
      for (const row of (marketRes.data ?? []) as { musical_scores: unknown }[]) {
        const m = readMeasurements(row.musical_scores);
        if (!m) continue;
        if (Number.isFinite(Number(m.pitch))) buckets.pitch.push(Number(m.pitch));
        if (Number.isFinite(Number(m.rhythm))) buckets.rhythm.push(Number(m.rhythm));
        if (Number.isFinite(Number(m.timbre))) buckets.timbre.push(Number(m.timbre));
        if (Number.isFinite(Number(m.tempo_bpm))) buckets.tempo_bpm.push(Number(m.tempo_bpm));
      }
      const next: Partial<Record<MarketMetric, CohortStat>> = {};
      for (const metric of Object.keys(buckets) as MarketMetric[]) {
        const stat = describeCohort(buckets[metric]);
        if (stat) next[metric] = stat;
      }
      setCohort(next);

      const mine = new Map<string, TrackMeasurements>();
      for (const row of (mineRes.data ?? []) as {
        audio_source_id: string | null;
        musical_scores: unknown;
      }[]) {
        if (!row.audio_source_id || mine.has(row.audio_source_id)) continue;
        const m = readMeasurements(row.musical_scores);
        if (m) mine.set(row.audio_source_id, m);
      }
      setMeasured(mine);
    } finally {
      setLoading(false);
    }
  }, [key]);

  useEffect(() => {
    if (lastKey.current === key) return;
    lastKey.current = key;
    void load();
  }, [key, load]);

  const bySource = useMemo(() => {
    const out = new Map<string, MarketOriginality>();
    for (const [sourceId, m] of measured) {
      out.set(sourceId, compareToMarket(m, baselines, cohort));
    }
    return out;
  }, [measured, baselines, cohort]);

  const liveCohortSize = useMemo(
    () => Math.max(0, ...Object.values(cohort).map((c) => c?.sample_size ?? 0)),
    [cohort],
  );

  return { bySource, baselines, cohort, liveCohortSize, loading, reload: load };
}
