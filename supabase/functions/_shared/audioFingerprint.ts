/**
 * Canonical feature → six-axis mapping (server side).
 *
 * The browser measures the file locally (Web Audio + FFT) and sends only the
 * measured numbers here. This module is the authority: it re-derives the six
 * category scores, the confidence and the Resonance match from those numbers,
 * so a browser cannot invent scores and every published number can be recomputed.
 *
 * Kept byte-for-byte equivalent to `src/lib/nextlevel/audioEncoder.ts`'s
 * `audioFingerprint()` — a parity test in `src/test/audioEncoderParity.test.ts`
 * fails if the two ever drift.
 */

export const AXES = [
  "emotional",
  "cognitive",
  "social",
  "communication",
  "contextual",
  "artistic",
] as const;

export type Axis = (typeof AXES)[number];

export interface AudioFeatures {
  durationSec: number;
  sampleRate: number;
  rms: number;
  dynamicRange: number;
  centroidHz: number;
  flatness: number;
  rolloffHz: number;
  zeroCrossRate: number;
  speechBandRatio: number;
  voicing: number;
  onsetRate: number;
  activity: number;
}

const clamp01 = (v: number) => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0);
const scale = (v: number, lo: number, hi: number) => clamp01((v - lo) / (hi - lo || 1));

const FEATURE_BOUNDS: Record<keyof AudioFeatures, [number, number]> = {
  durationSec: [0, 86_400],
  sampleRate: [1, 384_000],
  rms: [0, 1],
  dynamicRange: [0, 1],
  centroidHz: [0, 192_000],
  flatness: [0, 1],
  rolloffHz: [0, 192_000],
  zeroCrossRate: [0, 384_000],
  speechBandRatio: [0, 1],
  voicing: [0, 1],
  onsetRate: [0, 100],
  activity: [0, 1],
};

/**
 * Clamp every incoming measurement into a physically possible range, so a
 * hostile or buggy client cannot push a score out of shape.
 */
export function sanitizeFeatures(input: unknown): AudioFeatures {
  const raw = (input ?? {}) as Record<string, unknown>;
  const out = {} as AudioFeatures;
  for (const key of Object.keys(FEATURE_BOUNDS) as (keyof AudioFeatures)[]) {
    const [lo, hi] = FEATURE_BOUNDS[key];
    const n = Number(raw[key]);
    out[key] = Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : lo;
  }
  return out;
}

/** Deterministic six-axis scores from measured signal features. */
export function axesFromFeatures(f: AudioFeatures): Record<Axis, number> {
  const brightness = scale(f.centroidHz, 300, 6000);
  const noisiness = clamp01(f.flatness * 1.6);
  const busy = scale(f.onsetRate, 0.2, 6);
  const speech = clamp01(f.speechBandRatio);
  const voiced = clamp01(f.voicing);
  const dyn = scale(f.dynamicRange, 0.01, 0.35);
  const body = scale(f.rolloffHz, 1500, 11000);
  const level = scale(f.rms, 0.01, 0.3);

  const blend: Record<Axis, number> = {
    emotional: 0.4 * dyn + 0.25 * level + 0.2 * voiced + 0.15 * (1 - noisiness),
    cognitive: 0.4 * speech + 0.25 * (1 - busy) + 0.2 * voiced + 0.15 * (1 - dyn),
    social: 0.4 * busy + 0.3 * noisiness + 0.2 * body + 0.1 * level,
    communication: 0.5 * speech + 0.3 * voiced + 0.2 * (1 - brightness),
    contextual: 0.35 * noisiness + 0.3 * body + 0.2 * (1 - dyn) + 0.15 * f.activity,
    artistic: 0.35 * (1 - noisiness) + 0.25 * busy + 0.2 * brightness + 0.2 * dyn,
  };

  const scores = {} as Record<Axis, number>;
  for (const axis of AXES) {
    scores[axis] = Math.round(Math.min(97, Math.max(8, blend[axis] * 100)));
  }
  return scores;
}

/** How much of the file could actually be measured, 0..1. */
export function featureConfidence(f: AudioFeatures): number {
  const lengthAdequacy = scale(f.durationSec, 1, 15);
  return Math.round(clamp01(0.65 * f.activity + 0.35 * lengthAdequacy) * 100) / 100;
}

export interface ResonanceDefinition {
  version: string;
  weights: Partial<Record<Axis, number>>;
  distance_shape?: string;
}

export const DEFAULT_DEFINITION: ResonanceDefinition = {
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

const score100 = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(100, Math.max(0, n)) : 0;
};

/** Server-side Resonance Point — same formula as `src/lib/nextlevel/resonance.ts`. */
export function resonancePoint(
  content: Partial<Record<Axis, number>>,
  audience: Partial<Record<Axis, number>>,
  definition: ResonanceDefinition = DEFAULT_DEFINITION,
) {
  const shape = definition.distance_shape === "manhattan" ? "manhattan" : "euclidean";
  const gaps = {} as Record<Axis, number>;
  let acc = 0;
  let maxAcc = 0;
  let weakestAxis: Axis = AXES[0];
  let weakestCost = -1;

  for (const axis of AXES) {
    const weight = Math.max(0, Number(definition.weights?.[axis] ?? 1) || 0);
    const gap = score100(content[axis]) - score100(audience[axis]);
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
  const raw = maxDistance > 0 ? 100 * (1 - distance / maxDistance) : 100;

  return {
    score: Math.round(Math.min(100, Math.max(0, raw)) * 10) / 10,
    distance: Math.round(distance * 10) / 10,
    gaps,
    weakestAxis,
    definitionVersion: definition.version,
  };
}
