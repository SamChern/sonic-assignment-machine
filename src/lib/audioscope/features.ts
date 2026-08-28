/**
 * Meyda-backed feature extraction (MIT, npm `meyda`).
 *
 * The Semantic Scope draws two thin traces over the spectrogram — "energy"
 * (RMS) and "brightness" (spectral centroid) — and sends a compact feature
 * summary to `scope-window-score` once per window. Both come from here so the
 * numbers on screen and the numbers the model sees are literally the same.
 *
 * Meyda.extract is used statelessly on a power-of-two slice of whatever the
 * signal provider hands us, so it works identically for real audio (from the
 * AnalyserNode) and for a synthesized silhouette.
 */
import Meyda from "meyda";
import { clamp01 } from "./types";

/** Meyda needs a power-of-two frame; 512 is ~11ms at 44.1kHz. */
export const FEATURE_FRAME = 512;

export interface ScopeFeatures {
  /** 0..1 energy. */
  rms: number;
  /** Spectral centroid as a bin index (Meyda's native unit). */
  centroidBin: number;
  /** Spectral centroid in Hz, derived with the signal's sample rate. */
  centroidHz: number;
  /** 0..1 brightness, centroid normalized against ~4kHz. */
  brightness: number;
  /** 12-bin chroma, 0..1 each (empty when unavailable). */
  chroma: number[];
}

export function emptyFeatures(): ScopeFeatures {
  return { rms: 0, centroidBin: 0, centroidHz: 0, brightness: 0, chroma: [] };
}

/**
 * Extracts features from a time-domain buffer in -1..1.
 * Returns null when the buffer is too short or Meyda rejects the frame.
 */
export function extractFeatures(
  buffer: Float32Array,
  sampleRate = 44100,
): ScopeFeatures | null {
  if (!buffer || buffer.length < FEATURE_FRAME) return null;
  // Meyda requires exactly bufferSize samples.
  const frame =
    buffer.length === FEATURE_FRAME ? buffer : buffer.subarray(0, FEATURE_FRAME);
  try {
    Meyda.bufferSize = FEATURE_FRAME;
    Meyda.sampleRate = sampleRate;
    const out = Meyda.extract(["rms", "spectralCentroid", "chroma"], frame as unknown as Float32Array) as
      | { rms?: number; spectralCentroid?: number; chroma?: number[] }
      | null;
    if (!out) return null;
    const rms = clamp01(Number(out.rms) || 0);
    const centroidBin = Number(out.spectralCentroid) || 0;
    // Meyda reports the centroid as a bin index over bufferSize/2 bins.
    const centroidHz = (centroidBin / (FEATURE_FRAME / 2)) * (sampleRate / 2);
    return {
      rms,
      centroidBin,
      centroidHz,
      brightness: clamp01(centroidHz / 4000),
      chroma: Array.isArray(out.chroma) ? out.chroma.map((v) => clamp01(Number(v) || 0)) : [],
    };
  } catch {
    return null;
  }
}

/**
 * Rolling mean of the features seen inside one scoring window. The scorer gets
 * a stable summary rather than whichever frame happened to land last.
 */
export class FeatureWindow {
  private n = 0;
  private rms = 0;
  private centroidHz = 0;
  private chroma: number[] = [];

  push(f: ScopeFeatures | null) {
    if (!f) return;
    this.n += 1;
    this.rms += f.rms;
    this.centroidHz += f.centroidHz;
    if (f.chroma.length) {
      if (!this.chroma.length) this.chroma = new Array(f.chroma.length).fill(0);
      for (let i = 0; i < f.chroma.length; i++) this.chroma[i] += f.chroma[i];
    }
  }

  get count() {
    return this.n;
  }

  /** Mean features for the window, or null when nothing was captured. */
  summary(): ScopeFeatures | null {
    if (this.n === 0) return null;
    const centroidHz = this.centroidHz / this.n;
    return {
      rms: this.rms / this.n,
      centroidBin: 0,
      centroidHz,
      brightness: clamp01(centroidHz / 4000),
      chroma: this.chroma.map((v) => v / this.n),
    };
  }

  reset() {
    this.n = 0;
    this.rms = 0;
    this.centroidHz = 0;
    this.chroma = [];
  }
}
