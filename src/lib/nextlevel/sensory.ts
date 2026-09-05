/**
 * Signatures beyond hearing (Batch E, item 7).
 *
 * Maps the same six-axis vector the :03 signature is synthesised from onto a
 * vibration pattern and a light/colour pattern, so the signature can be felt
 * and seen — deaf and hard-of-hearing users get the same identity, not a
 * caption of it.
 *
 * Pure and deterministic: same vector in, same patterns out.
 */

import { RESONANCE_AXES, type AxisVector, type ResonanceAxis } from "./resonance";

/** Category hues (degrees) — kept in step with the six-category palette. */
export const AXIS_HUE: Record<ResonanceAxis, number> = {
  emotional: 348,
  cognitive: 268,
  social: 190,
  communication: 172,
  contextual: 38,
  artistic: 128,
};

export interface LightKeyframe {
  /** Milliseconds from the start of the 3.5s signature. */
  atMs: number;
  axis: ResonanceAxis;
  /** CSS colour, derived from the axis hue and its score. */
  color: string;
  /** 0..1 — brightness of this beat. */
  intensity: number;
}

export interface SensorySignature {
  /** navigator.vibrate() pattern: on, off, on, off … in milliseconds. */
  vibration: number[];
  /** Total pattern length in milliseconds (<= 3500). */
  durationMs: number;
  light: LightKeyframe[];
  /** Beats per minute the pattern pulses at (from the cognitive axis). */
  bpm: number;
}

const SIGNATURE_MS = 3500;
const clamp01 = (n: number) => (n < 0 ? 0 : n > 1 ? 1 : n);
const norm = (v: unknown) => clamp01((Number(v) || 0) / 100);

export function sensorySignature(vector: AxisVector): SensorySignature {
  const cognitive = norm(vector.cognitive);
  const emotional = norm(vector.emotional);
  const social = norm(vector.social);
  const artistic = norm(vector.artistic);

  // Tempo mirrors the audio mapping: 72–150 BPM from the cognitive axis.
  const bpm = Math.round(72 + cognitive * 78);
  const beatMs = Math.round(60000 / bpm);
  // Density: a solo pulse at low social, a layered burst at high social.
  const pulsesPerBeat = social > 0.72 ? 3 : social > 0.4 ? 2 : 1;
  // Intensity (emotional) sets how much of each beat is "on".
  const onMs = Math.max(20, Math.round((beatMs / pulsesPerBeat) * (0.25 + emotional * 0.5)));
  const gapMs = Math.max(15, Math.round(beatMs / pulsesPerBeat) - onMs);

  const vibration: number[] = [];
  const light: LightKeyframe[] = [];
  let t = 0;
  let beat = 0;

  while (t + onMs + gapMs <= SIGNATURE_MS) {
    for (let p = 0; p < pulsesPerBeat && t + onMs + gapMs <= SIGNATURE_MS; p++) {
      // Ornamented beats (artistic) get a slightly longer accent.
      const accent = artistic > 0.66 && p === pulsesPerBeat - 1 ? 1.35 : 1;
      const on = Math.round(onMs * accent);
      vibration.push(on, gapMs);

      const axis = RESONANCE_AXES[(beat + p) % RESONANCE_AXES.length];
      const score = norm(vector[axis]);
      light.push({
        atMs: t,
        axis,
        color: `hsl(${AXIS_HUE[axis]} ${Math.round(45 + score * 45)}% ${Math.round(30 + score * 35)}%)`,
        intensity: Math.round((0.35 + score * 0.65) * 100) / 100,
      });
      t += on + gapMs;
    }
    beat += 1;
  }

  return { vibration, durationMs: t, light, bpm };
}

/** Fires the pattern on devices that support vibration; a no-op elsewhere. */
export function playVibration(pattern: number[]): boolean {
  const nav = typeof navigator === "undefined" ? undefined : (navigator as Navigator & {
    vibrate?: (p: number | number[]) => boolean;
  });
  if (!nav?.vibrate) return false;
  try {
    return nav.vibrate(pattern);
  } catch {
    return false;
  }
}
