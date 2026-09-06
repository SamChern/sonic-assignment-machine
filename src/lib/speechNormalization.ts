export const CATEGORIES = [
  "emotional",
  "cognitive",
  "social",
  "communication",
  "contextual",
  "artistic",
] as const;
export type Category = (typeof CATEGORIES)[number];

/** Share of each category treated as speech-driven inflation (mirrors backend). */
export const SPEECH_LOAD: Record<Category, number> = {
  emotional: 0.05,
  cognitive: 0.2,
  social: 0.1,
  communication: 0.6,
  contextual: 0.05,
  artistic: 0.15,
};

export const GRADIENTS: Record<Category, string> = {
  emotional: "var(--gradient-emotional)",
  cognitive: "var(--gradient-cognitive)",
  social: "var(--gradient-social)",
  communication: "var(--gradient-communication)",
  contextual: "var(--gradient-contextual)",
  artistic: "var(--gradient-artistic)",
};

export const clamp = (n: number) => Math.max(0, Math.min(100, n));

/** Client mirror of the edge-function normalization math. */
export function normalizeScores(
  raw: Record<Category, number>,
  cfg: { enabled: boolean; speech_bias: number; redistribute: boolean; gains: Record<string, number> },
): Record<Category, number> {
  const out = {} as Record<Category, number>;
  if (!cfg.enabled) {
    for (const c of CATEGORIES) out[c] = clamp(raw[c] ?? 0);
    return out;
  }
  const bias = Math.max(0, Math.min(1, cfg.speech_bias));
  const damped = {} as Record<Category, number>;
  let removed = 0;
  for (const c of CATEGORIES) {
    const v = raw[c] ?? 0;
    const cut = v * bias * SPEECH_LOAD[c];
    damped[c] = v - cut;
    removed += cut;
  }
  if (cfg.redistribute && removed > 0) {
    let total = 0;
    const w = {} as Record<Category, number>;
    for (const c of CATEGORIES) {
      w[c] = damped[c] * (1 - SPEECH_LOAD[c]);
      total += w[c];
    }
    if (total > 0) for (const c of CATEGORIES) damped[c] += removed * (w[c] / total);
  }
  for (const c of CATEGORIES) {
    out[c] = Math.round(clamp(damped[c] * (cfg.gains?.[c] ?? 1)) * 10) / 10;
  }
  return out;
}

export interface ImpactRow {
  category: Category;
  raw: number;
  damped: number;
  /** Points removed by speech damping (negative number). */
  cut: number;
  /** Points handed back by redistribution. */
  given: number;
  /** Points added/removed by the per-category gain. */
  gainDelta: number;
  final: number;
  net: number;
  speechLoad: number;
}

/** Stage-by-stage explanation of what normalization did to each category. */
export function explainNormalization(
  raw: Record<Category, number>,
  cfg: { enabled: boolean; speech_bias: number; redistribute: boolean; gains: Record<string, number> },
): { rows: ImpactRow[]; removed: number; redistributed: number; enabled: boolean } {
  if (!cfg.enabled) {
    return {
      enabled: false,
      removed: 0,
      redistributed: 0,
      rows: CATEGORIES.map((c) => ({
        category: c,
        raw: clamp(raw[c] ?? 0),
        damped: clamp(raw[c] ?? 0),
        cut: 0,
        given: 0,
        gainDelta: 0,
        final: clamp(raw[c] ?? 0),
        net: 0,
        speechLoad: SPEECH_LOAD[c],
      })),
    };
  }

  const bias = Math.max(0, Math.min(1, cfg.speech_bias));
  const cut = {} as Record<Category, number>;
  const damped = {} as Record<Category, number>;
  let removed = 0;
  for (const c of CATEGORIES) {
    const v = raw[c] ?? 0;
    cut[c] = v * bias * SPEECH_LOAD[c];
    damped[c] = v - cut[c];
    removed += cut[c];
  }

  const given = {} as Record<Category, number>;
  for (const c of CATEGORIES) given[c] = 0;
  let redistributed = 0;
  if (cfg.redistribute && removed > 0) {
    let total = 0;
    const w = {} as Record<Category, number>;
    for (const c of CATEGORIES) {
      w[c] = damped[c] * (1 - SPEECH_LOAD[c]);
      total += w[c];
    }
    if (total > 0) {
      for (const c of CATEGORIES) {
        given[c] = removed * (w[c] / total);
        redistributed += given[c];
      }
    }
  }

  const rows = CATEGORIES.map((c) => {
    const preGain = damped[c] + given[c];
    const final = Math.round(clamp(preGain * (cfg.gains?.[c] ?? 1)) * 10) / 10;
    return {
      category: c,
      raw: raw[c] ?? 0,
      damped: damped[c],
      cut: -cut[c],
      given: given[c],
      gainDelta: final - clamp(preGain),
      final,
      net: final - (raw[c] ?? 0),
      speechLoad: SPEECH_LOAD[c],
    };
  });

  return { rows, removed, redistributed, enabled: true };
}

export interface Cfg {
  scope: string;
  enabled: boolean;
  speech_bias: number;
  redistribute: boolean;
  gains: Record<string, number>;
}

export const DEFAULT_GAINS: Record<string, number> = {
  emotional: 1,
  cognitive: 1,
  social: 1,
  communication: 1,
  contextual: 1,
  artistic: 1,
};

export const SCOPES: { value: string; label: string; hint: string }[] = [
  { value: "intuizi", label: "Intuizi feeds", hint: "CTV + audio-app device streams from Intuizi" },
  { value: "ctv", label: "CTV batches", hint: "Admin-submitted CTV ingest batches" },
  { value: "global", label: "Global default", hint: "Fallback for music / file uploads" },
];

/* -------------------------------------------------------------- auto-tune */

export const SOURCE_TYPES_BY_SCOPE: Record<string, string[] | null> = {
  intuizi: ["intuizi"],
  ctv: ["ctv"],
  global: null, // everything else (music / uploads)
};

const round05 = (n: number) => Math.round(n / 0.05) * 0.05;
const clampRange = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

export interface AutoTuneResult {
  sampleSize: number;
  usedRaw: number;
  means: Record<Category, number>;
  /** Recommended settings. */
  speech_bias: number;
  gains: Record<string, number>;
  /** Category means after applying the recommendation. */
  tuned: Record<Category, number>;
  notes: string[];
}

/**
 * Recommends speech_bias + per-category gains from recent ingests in a scope.
 * Bias comes from how far Communication over-indexes vs the other categories
 * (divided by its speech load); gains nudge each category halfway toward the
 * post-damping average so no single dimension dominates the learned profile.
 */
export function computeAutoTune(
  samples: { scores: Record<Category, number>; isRaw: boolean }[],
  redistribute: boolean,
): AutoTuneResult | null {
  if (samples.length === 0) return null;

  const means = {} as Record<Category, number>;
  for (const c of CATEGORIES) {
    means[c] = samples.reduce((sum, s) => sum + (s.scores[c] ?? 0), 0) / samples.length;
  }

  const notes: string[] = [];
  const comm = means.communication;
  const others = CATEGORIES.filter((c) => c !== "communication");
  const otherMean = others.reduce((a, c) => a + means[c], 0) / others.length;

  let bias = 0;
  if (comm > 0 && comm > otherMean) {
    const excessShare = (comm - otherMean) / comm;
    bias = clampRange(round05(excessShare / SPEECH_LOAD.communication), 0, 1);
  }
  if (bias === 0) {
    notes.push("Communication does not over-index in this scope — damping stays near zero.");
  }

  const damped = normalizeScores(means, {
    enabled: true,
    speech_bias: bias,
    redistribute,
    gains: { ...DEFAULT_GAINS },
  });

  const dampedMean =
    CATEGORIES.reduce((a, c) => a + (damped[c] ?? 0), 0) / CATEGORIES.length;

  const gains: Record<string, number> = {};
  for (const c of CATEGORIES) {
    const v = damped[c] ?? 0;
    if (v <= 0 || dampedMean <= 0) {
      gains[c] = 1;
      continue;
    }
    // Blend halfway toward flat so real signal differences survive.
    gains[c] = clampRange(round05(1 + 0.5 * (dampedMean / v - 1)), 0.5, 1.5);
  }

  const tuned = normalizeScores(means, {
    enabled: true,
    speech_bias: bias,
    redistribute,
    gains,
  });

  const usedRaw = samples.filter((s) => s.isRaw).length;
  if (usedRaw === 0) {
    notes.push(
      "No raw pre-normalization scores stored yet — recommendation is based on already-stored profiles, so re-run after new ingests for a tighter fit.",
    );
  }
  if (samples.length < 5) {
    notes.push(`Only ${samples.length} recent analysis(es) in scope — treat this as a rough start.`);
  }

  return { sampleSize: samples.length, usedRaw, means, speech_bias: bias, gains, tuned, notes };
}
