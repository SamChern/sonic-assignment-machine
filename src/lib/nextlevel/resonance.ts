/**
 * Resonance Point (Batch E, item 1).
 *
 * One auditable per-impression score: how closely a piece of content's
 * six-axis fingerprint sits to the audience's six-axis fingerprint, under a
 * stored, versioned weight set (`public.resonance_definitions`).
 *
 * The score is a pure function of the two vectors plus the definition, so any
 * number the product shows can be recomputed and audited later.
 */

export const RESONANCE_AXES = [
  "emotional",
  "cognitive",
  "social",
  "communication",
  "contextual",
  "artistic",
] as const;

export type ResonanceAxis = (typeof RESONANCE_AXES)[number];
export type AxisVector = Partial<Record<ResonanceAxis, number>>;
export type AxisWeights = Partial<Record<ResonanceAxis, number>>;

export interface ResonanceDefinition {
  version: string;
  weights: AxisWeights;
  /** Only 'euclidean' and 'manhattan' are defined in v1. */
  distance_shape?: string;
}

export const DEFAULT_RESONANCE_DEFINITION: ResonanceDefinition = {
  version: "v1",
  weights: {
    emotional: 1,
    cognitive: 1,
    social: 1,
    communication: 1,
    contextual: 1.25,
    artistic: 0.75,
  },
  distance_shape: "euclidean",
};

export interface ResonanceResult {
  /** 0..100 — 100 means the content sits exactly on the audience centre. */
  score: number;
  /** Weighted distance, in score points. */
  distance: number;
  /** Per-axis signed gap (content − audience), for the "why" line. */
  gaps: Record<ResonanceAxis, number>;
  /** The axis pulling the score down hardest. */
  weakestAxis: ResonanceAxis;
  definitionVersion: string;
}

const num = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(100, Math.max(0, n)) : 0;
};

/** Resonance of one content vector against one audience vector. */
export function resonancePoint(
  content: AxisVector,
  audience: AxisVector,
  definition: ResonanceDefinition = DEFAULT_RESONANCE_DEFINITION,
): ResonanceResult {
  const shape = definition.distance_shape === "manhattan" ? "manhattan" : "euclidean";
  const gaps = {} as Record<ResonanceAxis, number>;

  let acc = 0;
  let maxAcc = 0;
  let weakestAxis: ResonanceAxis = RESONANCE_AXES[0];
  let weakestCost = -1;

  for (const axis of RESONANCE_AXES) {
    const weight = Math.max(0, Number(definition.weights?.[axis] ?? 1) || 0);
    const gap = num(content[axis]) - num(audience[axis]);
    gaps[axis] = Math.round(gap * 10) / 10;

    const cost = shape === "manhattan" ? weight * Math.abs(gap) : weight * gap * gap;
    acc += cost;
    maxAcc += shape === "manhattan" ? weight * 100 : weight * 100 * 100;
    if (cost > weakestCost) {
      weakestCost = cost;
      weakestAxis = axis;
    }
  }

  const distance = shape === "manhattan" ? acc : Math.sqrt(acc);
  const maxDistance = shape === "manhattan" ? maxAcc : Math.sqrt(maxAcc);
  const score = maxDistance > 0 ? 100 * (1 - distance / maxDistance) : 100;

  return {
    score: Math.round(Math.min(100, Math.max(0, score)) * 10) / 10,
    distance: Math.round(distance * 10) / 10,
    gaps,
    weakestAxis,
    definitionVersion: definition.version,
  };
}

/** Mean resonance across many content vectors against one audience. */
export function resonanceIndex(
  contents: AxisVector[],
  audience: AxisVector,
  definition: ResonanceDefinition = DEFAULT_RESONANCE_DEFINITION,
): { index: number; count: number } {
  if (contents.length === 0) return { index: 0, count: 0 };
  const total = contents.reduce((sum, c) => sum + resonancePoint(c, audience, definition).score, 0);
  return { index: Math.round((total / contents.length) * 10) / 10, count: contents.length };
}

/** Plain-language read of a resonance score, for non-technical surfaces. */
export function resonanceWording(score: number): string {
  if (score >= 85) return "Very close match";
  if (score >= 70) return "Close match";
  if (score >= 55) return "Partial match";
  return "Weak match";
}
