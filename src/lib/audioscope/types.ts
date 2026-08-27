export const AUDIOSCOPE_CATEGORIES = [
  "emotional",
  "cognitive",
  "social",
  "communication",
  "contextual",
  "artistic",
] as const;

export type AudioscopeCategory = (typeof AUDIOSCOPE_CATEGORIES)[number];

export type CategoryScores = Record<AudioscopeCategory, number>;

/** Optional DSP hints (from librosa features) that shape the synthetic signal. */
export interface AudioscopeFeatureHints {
  /** BPM — drives the pulse rate. */
  tempo?: number | null;
  /** Spectral centroid in Hz — drives brightness / high-band weight. */
  spectralCentroid?: number | null;
  /** RMS energy 0..1 — drives amplitude. */
  energy?: number | null;
}

/**
 * A signal provider hands the renderer a normalized waveform (-1..1) and a
 * normalized spectrum (0..1) for the current animation frame. Both real audio
 * and synthesized fingerprints implement this, so the renderer never has to
 * care where the signal came from.
 */
export interface AudioscopeSignal {
  readonly kind: "live" | "synthetic";
  /** Fill `out` with time-domain samples in -1..1. */
  waveform(out: Float32Array, timeSeconds: number): void;
  /** Fill `out` with magnitudes in 0..1. */
  spectrum(out: Float32Array, timeSeconds: number): void;
  /** Per-category energy 0..1 for the current frame (drives node pulse). */
  bands(timeSeconds: number): CategoryScores;
  dispose(): void;
}

export function emptyScores(): CategoryScores {
  return {
    emotional: 0,
    cognitive: 0,
    social: 0,
    communication: 0,
    contextual: 0,
    artistic: 0,
  };
}

export function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** FNV-1a — deterministic seed from any id string. */
export function hashSeed(seed: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}
