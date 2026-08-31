/**
 * Market originality — how a track sits against a real market, not our samples.
 *
 * The Originality Score answers "is this distinctive given what we measured".
 * That is an internal judgement. This module answers a harder, outward-facing
 * question: *against real released music*, where does this track sit?
 *
 * Two reference cohorts, in order of preference per metric:
 *   1. Live cohort  — analyses of commercially released audio already in the
 *      platform (Spotify / Apple linked sources, never Intuizi CTV samples).
 *      Used once a metric has enough scored tracks to be worth quoting.
 *   2. Published baseline — the `market_baselines` table: the market centre and
 *      spread for tempo, loudness, pitch, rhythm and timbre taken from a public
 *      commercial-release corpus, with the source noted on every row.
 *
 * For each metric we take the z-score against that cohort and read two things
 * off it: the *percentile* (where the track ranks) and the *distinctiveness*
 * (how far from the market centre it sits, in either direction). Market
 * originality is the weighted distinctiveness; percentiles are what we show so
 * the number is legible ("top 8% of tempo vs 170k releases").
 */

export type MarketMetric = "pitch" | "rhythm" | "timbre" | "tempo_bpm" | "loudness_db";

export interface MarketBaseline {
  market: string;
  market_label: string;
  metric: string;
  mean: number;
  stddev: number;
  sample_size: number;
  unit?: string | null;
  source_note: string;
}

/** A measured cohort computed from real released audio in the platform. */
export interface CohortStat {
  mean: number;
  stddev: number;
  sample_size: number;
}

export interface TrackMeasurements {
  pitch?: number | null;
  rhythm?: number | null;
  timbre?: number | null;
  tempo_bpm?: number | null;
  loudness_db?: number | null;
}

export interface MetricComparison {
  metric: MarketMetric;
  label: string;
  unit: string | null;
  value: number;
  marketMean: number;
  /** Signed standard deviations from the market centre. */
  z: number;
  /** 0-100: share of the market this track sits above. */
  percentile: number;
  /** 0-100: distance from the market centre, either direction. */
  distinctiveness: number;
  /** Which cohort backed this metric. */
  basis: "live" | "published";
  sampleSize: number;
  note: string;
}

export interface MarketOriginality {
  /** 0-100 weighted distinctiveness vs the market, or null with no metrics. */
  score: number | null;
  /** 0-1 — how much of the comparison was actually backed by data. */
  confidence: number;
  metrics: MetricComparison[];
  marketLabel: string;
  /** Smallest cohort behind any used metric — what we can honestly quote. */
  sampleSize: number;
  summary: string;
}

const METRIC_META: Record<MarketMetric, { label: string; weight: number; unit: string | null }> = {
  pitch: { label: "Pitch", weight: 0.25, unit: "0-100" },
  rhythm: { label: "Rhythm", weight: 0.25, unit: "0-100" },
  timbre: { label: "Timbre", weight: 0.25, unit: "0-100" },
  tempo_bpm: { label: "Tempo", weight: 0.15, unit: "BPM" },
  loudness_db: { label: "Loudness", weight: 0.1, unit: "dBFS" },
};

/** A live cohort needs this many scored tracks before it beats the baseline. */
export const LIVE_COHORT_MIN = 30;

const clamp = (n: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, n));
const round = (n: number, dp = 0) => {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
};

/** Normal CDF (Abramowitz & Stegun 7.1.26) — good to ~1e-7, no dependency. */
function normalCdf(z: number): number {
  const sign = z < 0 ? -1 : 1;
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const erf =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-x * x);
  return 0.5 * (1 + sign * erf);
}

/**
 * Compare one track's measurements against the market.
 *
 * @param measured the track's own numbers (missing metrics are skipped)
 * @param baselines published baseline rows for the chosen market
 * @param cohort live cohort stats per metric, measured from released audio
 */
export function compareToMarket(
  measured: TrackMeasurements,
  baselines: MarketBaseline[],
  cohort: Partial<Record<MarketMetric, CohortStat>> = {},
): MarketOriginality {
  const baseByMetric = new Map(baselines.map((b) => [b.metric, b]));
  const marketLabel = baselines[0]?.market_label ?? "Commercial releases";

  const metrics: MetricComparison[] = [];
  for (const key of Object.keys(METRIC_META) as MarketMetric[]) {
    const raw = Number(measured[key]);
    if (!Number.isFinite(raw)) continue;

    const live = cohort[key];
    const base = baseByMetric.get(key);
    const useLive = !!live && live.sample_size >= LIVE_COHORT_MIN && live.stddev > 0;
    const ref = useLive
      ? { mean: live!.mean, stddev: live!.stddev, sample: live!.sample_size, basis: "live" as const }
      : base && base.stddev > 0
        ? {
            mean: Number(base.mean),
            stddev: Number(base.stddev),
            sample: Number(base.sample_size),
            basis: "published" as const,
          }
        : null;
    if (!ref) continue;

    const z = (raw - ref.mean) / ref.stddev;
    const percentile = clamp(normalCdf(z) * 100);
    // 2 sd from the centre in either direction reads as fully distinctive.
    const distinctiveness = clamp((Math.min(Math.abs(z), 2) / 2) * 100);

    metrics.push({
      metric: key,
      label: METRIC_META[key].label,
      unit: (useLive ? null : base?.unit) ?? METRIC_META[key].unit,
      value: round(raw, key === "tempo_bpm" || key === "loudness_db" ? 1 : 0),
      marketMean: round(ref.mean, 1),
      z: round(z, 2),
      percentile: round(percentile),
      distinctiveness: round(distinctiveness),
      basis: ref.basis,
      sampleSize: ref.sample,
      note:
        ref.basis === "live"
          ? `Measured against ${ref.sample.toLocaleString()} released tracks analysed here.`
          : (base?.source_note ?? "Published commercial-release reference."),
    });
  }

  if (!metrics.length) {
    return {
      score: null,
      confidence: 0,
      metrics: [],
      marketLabel,
      sampleSize: 0,
      summary: "No measured audio yet — upload the track and run the analysis.",
    };
  }

  const weightSum = metrics.reduce((a, m) => a + METRIC_META[m.metric].weight, 0);
  const score = round(
    clamp(
      metrics.reduce((a, m) => a + m.distinctiveness * METRIC_META[m.metric].weight, 0) / weightSum,
    ),
  );

  // Confidence: how much of the metric weight we covered, lifted when the
  // comparison stands on live measurements rather than a published average.
  const coverage = weightSum; // weights sum to 1 across all metrics
  const liveShare =
    metrics.filter((m) => m.basis === "live").reduce((a, m) => a + METRIC_META[m.metric].weight, 0) /
    weightSum;
  const confidence = Math.max(0, Math.min(1, 0.75 * coverage + 0.25 * liveShare));

  const strongest = [...metrics].sort((a, b) => b.distinctiveness - a.distinctiveness)[0];
  const side = strongest.z >= 0 ? "above" : "below";
  const tail = round(strongest.z >= 0 ? 100 - strongest.percentile : strongest.percentile);
  const summary =
    score >= 65
      ? `Sits well outside the market centre — ${strongest.label.toLowerCase()} is ${side} it, in the ${tail}% tail of ${marketLabel.toLowerCase()}.`
      : score >= 35
        ? `Recognisably in-market with its own lean: ${strongest.label.toLowerCase()} sits ${side} the market centre.`
        : `Very close to the market centre on every measured axis — a familiar, market-standard read.`;

  return {
    score,
    confidence: round(confidence, 3),
    metrics,
    marketLabel,
    sampleSize: Math.min(...metrics.map((m) => m.sampleSize)),
    summary,
  };
}

/** Mean and (sample) standard deviation, or null when there is nothing to say. */
export function describeCohort(values: number[]): CohortStat | null {
  const nums = values.map(Number).filter((n) => Number.isFinite(n));
  if (nums.length < 2) return null;
  const mean = nums.reduce((a, b) => a + b, 0) / nums.length;
  const variance = nums.reduce((a, v) => a + (v - mean) ** 2, 0) / (nums.length - 1);
  const stddev = Math.sqrt(variance);
  if (!(stddev > 0)) return null;
  return { mean, stddev, sample_size: nums.length };
}
