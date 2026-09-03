/**
 * Tag → category attribution.
 *
 * A source's six scores are produced by the ontology as a whole, but every
 * Intuizi taxonomy tag attached to that source carries its own learned
 * per-category behaviour in `category_calibration` (Welford mean over every
 * analysis that ever wore the tag). Multiplying the tag's weight on this source
 * by that calibrated mean — shrunk toward zero while the sample is small —
 * gives a defensible per-tag contribution, so the dashboard can show *which*
 * Intuizi tags drive each category instead of only the average.
 */

export const CATEGORIES = [
  "emotional",
  "cognitive",
  "social",
  "communication",
  "contextual",
  "artistic",
] as const;
export type Category = (typeof CATEGORIES)[number];

export interface TagRow {
  nodeId: string;
  code: string;
  label: string;
  /** Weight of this tag on the source (audio_source_tags.weight). */
  weight: number;
}

export interface CalibrationRow {
  nodeId: string;
  category: string;
  /** Learned mean score (0-100) for this tag in this category. */
  meanScore: number;
  /** Observation count behind the mean. */
  n: number;
}

export interface TagContribution {
  code: string;
  label: string;
  weight: number;
  /** Calibrated mean score for this tag in this category (0-100). */
  meanScore: number;
  /** Observations behind the mean — low n means a soft claim. */
  n: number;
  /** Share of the category's tag evidence, 0-1. */
  share: number;
  /** True when the sample is too thin to trust on its own. */
  thin: boolean;
}

export interface CategoryAttribution {
  category: Category;
  tags: TagContribution[];
  /** Weighted mean of the contributing tags' calibrated scores (0-100). */
  tagScore: number | null;
  /** Total observations behind the category's mapping. */
  observations: number;
}

/** Shrinkage prior: a tag needs a handful of sightings to speak at full volume. */
const SHRINK_N = 3;
const THIN_N = 3;

export function attributeTags(
  tags: TagRow[],
  calibration: CalibrationRow[],
  opts: { maxPerCategory?: number } = {},
): CategoryAttribution[] {
  const maxPerCategory = opts.maxPerCategory ?? 6;
  const byNode = new Map(tags.map((t) => [t.nodeId, t]));

  return CATEGORIES.map((category) => {
    const scored = calibration
      .filter((c) => c.category === category && byNode.has(c.nodeId))
      .map((c) => {
        const tag = byNode.get(c.nodeId)!;
        const weight = Number.isFinite(tag.weight) ? Math.max(0, tag.weight) : 0;
        const n = Math.max(0, Math.round(c.n));
        const confidence = n / (n + SHRINK_N);
        const evidence = weight * (c.meanScore / 100) * confidence;
        return {
          code: tag.code,
          label: tag.label,
          weight,
          meanScore: c.meanScore,
          n,
          evidence,
          thin: n < THIN_N,
        };
      })
      .filter((t) => t.evidence > 0);

    const total = scored.reduce((a, t) => a + t.evidence, 0);
    const weightSum = scored.reduce((a, t) => a + t.weight, 0);
    const tagScore = weightSum
      ? Math.round(
          scored.reduce((a, t) => a + t.weight * t.meanScore, 0) / weightSum,
        )
      : null;

    const ranked = scored
      .sort((a, b) => b.evidence - a.evidence)
      .slice(0, maxPerCategory)
      .map(({ evidence, ...t }) => ({
        ...t,
        share: total ? evidence / total : 0,
      }));

    return {
      category,
      tags: ranked,
      tagScore,
      observations: scored.reduce((a, t) => a + t.n, 0),
    };
  });
}

/** Signed gap between the model's category score and its tag-implied score. */
export function tagDelta(
  modelScore: number,
  attribution: CategoryAttribution,
): number | null {
  if (attribution.tagScore === null) return null;
  return Math.round(modelScore - attribution.tagScore);
}
