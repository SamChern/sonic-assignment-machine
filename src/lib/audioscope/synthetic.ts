import {
  AUDIOSCOPE_CATEGORIES,
  clamp01,
  emptyScores,
  hashSeed,
  type AudioscopeFeatureHints,
  type AudioscopeSignal,
  type CategoryScores,
} from "./types";

interface SyntheticOptions {
  scores: CategoryScores;
  /** Stable id so a given fingerprint always animates identically. */
  seed?: string;
  features?: AudioscopeFeatureHints | null;
}

/**
 * Synthesized scope: the six category scores become six harmonic partials.
 * Amplitude comes from the score, frequency from the band index (scaled by
 * tempo when DSP features exist), phase from a deterministic hash of the seed.
 */
export function createSyntheticSignal({ scores, seed = "sonicsim", features }: SyntheticOptions): AudioscopeSignal {
  const h = hashSeed(seed);
  const phases = AUDIOSCOPE_CATEGORIES.map((_, i) => ((h >>> (i * 3)) % 360) * (Math.PI / 180));

  const tempo = features?.tempo && features.tempo > 20 ? features.tempo : 96;
  // Pulse rate in cycles per second across the visible buffer.
  const rate = tempo / 120;
  const brightness = features?.spectralCentroid
    ? clamp01(features.spectralCentroid / 4000) * 0.8 + 0.6
    : 1;
  const gain = features?.energy != null ? clamp01(features.energy) * 0.6 + 0.55 : 0.9;

  const amps = AUDIOSCOPE_CATEGORIES.map((c) => clamp01((Number(scores[c]) || 0) / 100));
  const ampSum = amps.reduce((a, b) => a + b, 0) || 1;

  const bandEnergy = (t: number, i: number) => {
    const f = rate * (0.35 + i * 0.42);
    return clamp01(amps[i] * (0.62 + 0.38 * Math.sin(2 * Math.PI * f * t + phases[i])));
  };

  return {
    kind: "synthetic",
    waveform(out, t) {
      const n = out.length;
      for (let s = 0; s < n; s++) {
        const x = s / n;
        let v = 0;
        for (let i = 0; i < amps.length; i++) {
          const partial = (i + 1) * (1 + i * 0.15 * brightness);
          v +=
            amps[i] *
            Math.sin(2 * Math.PI * (partial * 2 * x + rate * t) + phases[i]) *
            (0.7 + 0.3 * Math.sin(2 * Math.PI * (rate * 0.25 * t) + phases[i]));
        }
        // Gentle envelope so the trace never clips the frame edges.
        const env = 0.85 + 0.15 * Math.sin(Math.PI * x);
        out[s] = (v / ampSum) * gain * env;
      }
    },
    spectrum(out, t) {
      const n = out.length;
      for (let b = 0; b < n; b++) {
        const pos = (b / n) * (amps.length - 1);
        const i = Math.floor(pos);
        const f = pos - i;
        const a = bandEnergy(t, i);
        const c = bandEnergy(t, Math.min(amps.length - 1, i + 1));
        const base = a + (c - a) * f;
        const tilt = Math.pow(1 - b / n, 0.6 / brightness);
        out[b] = clamp01(base * tilt * gain * (0.85 + 0.15 * Math.sin(2 * Math.PI * (rate * t + b / n))));
      }
    },
    bands(t) {
      const res = emptyScores();
      AUDIOSCOPE_CATEGORIES.forEach((c, i) => {
        res[c] = bandEnergy(t, i);
      });
      return res;
    },
    dispose() {
      /* nothing to release */
    },
  };
}
