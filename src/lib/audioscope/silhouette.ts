/**
 * The zero-audio scope — a subject's *expected sonic silhouette*.
 *
 * Intuizi subjects have no waveform: all we hold is a six-axis vector plus the
 * taxonomy tags that fired, with weights. This composes those into a
 * deterministic sine stack rendered by the very same canvas code as real audio,
 * so "what does this cohort sound like" becomes a picture. Same input always
 * produces the same trace (pure function of scores + tag codes/weights + seed).
 */
import { createSyntheticSignal } from "./synthetic";
import {
  AUDIOSCOPE_CATEGORIES,
  clamp01,
  hashSeed,
  type AudioscopeCategory,
  type AudioscopeFeatureHints,
  type AudioscopeSignal,
  type CategoryScores,
} from "./types";

export interface SilhouetteTag {
  code: string;
  label?: string;
  /** 0..1 tag weight or similarity. */
  weight: number;
}

export interface SilhouetteOptions {
  scores: CategoryScores;
  tags?: SilhouetteTag[];
  seed?: string;
}

/** Stable ordering + rounding so equal inputs hash identically. */
function normalizeTags(tags: SilhouetteTag[] | undefined): SilhouetteTag[] {
  return (tags ?? [])
    .filter((t) => t && typeof t.code === "string")
    .map((t) => ({ code: t.code, label: t.label, weight: clamp01(Number(t.weight) || 0) }))
    .sort((a, b) => (b.weight - a.weight) || a.code.localeCompare(b.code))
    .slice(0, 8);
}

/**
 * Derives DSP hints from the tag mix: tag weight sum drives energy, the hashed
 * tag codes drive tempo and brightness. No randomness anywhere.
 */
export function silhouetteHints(
  scores: CategoryScores,
  tags?: SilhouetteTag[],
  seed = "silhouette",
): AudioscopeFeatureHints {
  const list = normalizeTags(tags);
  const weightSum = list.reduce((a, t) => a + t.weight, 0);
  const h = hashSeed(seed + "|" + list.map((t) => `${t.code}:${t.weight.toFixed(3)}`).join(","));

  const axisMean =
    AUDIOSCOPE_CATEGORIES.reduce((a, c) => a + (Number(scores[c]) || 0), 0) /
    AUDIOSCOPE_CATEGORIES.length;

  // Communication-heavy (spoken word) subjects read as brighter and slower.
  const speech = clamp01((Number(scores.communication) || 0) / 100);
  const artistic = clamp01((Number(scores.artistic) || 0) / 100);

  const tempo = 72 + (h % 40) + artistic * 46 - speech * 18;
  const spectralCentroid = 900 + speech * 2200 + artistic * 1400 + ((h >>> 8) % 400);
  const energy = clamp01(0.28 + axisMean / 260 + Math.min(0.35, weightSum * 0.12));

  return { tempo, spectralCentroid, energy };
}

/** Deterministic signal provider for a subject with no audio. */
export function createSilhouetteSignal({
  scores,
  tags,
  seed = "silhouette",
}: SilhouetteOptions): AudioscopeSignal {
  const list = normalizeTags(tags);
  // Tag codes participate in the seed so two subjects with identical axes but
  // different tags still look different.
  const tagSeed = `${seed}|${list.map((t) => `${t.code}:${t.weight.toFixed(3)}`).join(",")}`;
  const base = createSyntheticSignal({
    scores,
    seed: tagSeed,
    features: silhouetteHints(scores, list, seed),
  });
  return { ...base, kind: "synthetic" };
}

export interface AxisDivergence {
  category: AudioscopeCategory;
  delta: number;
  /** true for the axes that explain most of the distance. */
  divergent: boolean;
}

/**
 * Per-axis distance between two silhouettes, flagging the axes that carry the
 * divergence — this is the visual explanation of a similarity score.
 */
export function silhouetteDivergence(
  a: CategoryScores,
  b: CategoryScores,
  opts: { minDelta?: number; maxAxes?: number } = {},
): { axes: AxisDivergence[]; similarity: number } {
  const minDelta = opts.minDelta ?? 8;
  const maxAxes = opts.maxAxes ?? 3;
  const rows = AUDIOSCOPE_CATEGORIES.map((category) => ({
    category,
    delta: Math.abs((Number(a[category]) || 0) - (Number(b[category]) || 0)),
    divergent: false,
  }));
  const ranked = [...rows].sort((x, y) => y.delta - x.delta).slice(0, maxAxes);
  for (const r of ranked) {
    if (r.delta >= minDelta) {
      const target = rows.find((x) => x.category === r.category)!;
      target.divergent = true;
    }
  }
  const mean = rows.reduce((s, r) => s + r.delta, 0) / rows.length;
  return { axes: rows, similarity: Math.round(clamp01(1 - mean / 100) * 100) };
}
