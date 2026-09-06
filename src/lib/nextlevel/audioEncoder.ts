/**
 * On-device audio encoder (Batch E, item 3 — audio side).
 *
 * Decodes an audio file in the browser with the Web Audio API and measures a
 * small, honest set of signal features (loudness, dynamics, brightness, noisiness,
 * voicing, onset rate, speech-band energy). Those features are mapped to the six
 * categories by a deterministic, auditable function — no model, no network, no
 * credits. It is a real measurement of the file, not a placeholder.
 *
 * The mapping is intentionally documented per axis so any number can be traced
 * back to the signal that produced it.
 */

import { RESONANCE_AXES, type ResonanceAxis } from "./resonance";

export interface AudioFeatures {
  durationSec: number;
  sampleRate: number;
  /** Mean short-term loudness, 0..1 (RMS). */
  rms: number;
  /** Loudness spread across frames (dynamics), 0..1. */
  dynamicRange: number;
  /** Spectral centroid in Hz — perceived brightness. */
  centroidHz: number;
  /** Spectral flatness 0..1 — 1 is noise-like, 0 is tonal. */
  flatness: number;
  /** Frequency below which 85% of energy sits, in Hz. */
  rolloffHz: number;
  /** Zero crossings per second — high for noisy/fricative content. */
  zeroCrossRate: number;
  /** Share of energy in the 300–3400 Hz speech band, 0..1. */
  speechBandRatio: number;
  /** Strength of the strongest pitch period, 0..1 (autocorrelation peak). */
  voicing: number;
  /** Detected onsets per second — rhythmic activity. */
  onsetRate: number;
  /** Share of frames above the silence floor, 0..1. */
  activity: number;
}

export interface AudioFingerprint {
  scores: Record<ResonanceAxis, number>;
  features: AudioFeatures;
  engine: "on-device-audio";
  /** How much of the file could be measured, 0..1 (activity × length adequacy). */
  confidence: number;
}

const FRAME = 2048;
const HOP = 1024;
const SILENCE = 0.005;

const clamp01 = (v: number) => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0);
const scale = (v: number, lo: number, hi: number) => clamp01((v - lo) / (hi - lo || 1));

/** In-place iterative radix-2 FFT on real/imag pairs. */
function fft(re: Float32Array, im: Float32Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const ar = re[i + k];
        const ai = im[i + k];
        const br = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci;
        const bi = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr;
        re[i + k] = ar + br;
        im[i + k] = ai + bi;
        re[i + k + len / 2] = ar - br;
        im[i + k + len / 2] = ai - bi;
        const nr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = nr;
      }
    }
  }
}

/** Autocorrelation-based voicing strength over one frame (60–500 Hz range). */
function frameVoicing(frame: Float32Array, sampleRate: number): number {
  const minLag = Math.floor(sampleRate / 500);
  const maxLag = Math.min(frame.length - 1, Math.floor(sampleRate / 60));
  if (maxLag <= minLag) return 0;
  let energy = 0;
  for (let i = 0; i < frame.length; i++) energy += frame[i] * frame[i];
  if (energy <= 0) return 0;
  let best = 0;
  for (let lag = minLag; lag <= maxLag; lag++) {
    let acc = 0;
    for (let i = 0; i < frame.length - lag; i++) acc += frame[i] * frame[i + lag];
    if (acc > best) best = acc;
  }
  return clamp01(best / energy);
}

/** Measure a decoded mono signal. Pure and deterministic. */
export function extractAudioFeatures(samples: Float32Array, sampleRate: number): AudioFeatures {
  const durationSec = samples.length / sampleRate;
  const window = new Float32Array(FRAME);
  for (let i = 0; i < FRAME; i++) window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (FRAME - 1));

  const frames: number[] = [];
  let centroidAcc = 0;
  let rolloffAcc = 0;
  let flatnessAcc = 0;
  let speechAcc = 0;
  let voicingAcc = 0;
  let spectralFrames = 0;
  let zeroCrossings = 0;
  const flux: number[] = [];
  let prevMag: Float32Array | null = null;

  const re = new Float32Array(FRAME);
  const im = new Float32Array(FRAME);
  const frameBuf = new Float32Array(FRAME);

  for (let start = 0; start + FRAME <= samples.length; start += HOP) {
    let sum = 0;
    for (let i = 0; i < FRAME; i++) {
      const s = samples[start + i];
      frameBuf[i] = s;
      sum += s * s;
      if (i > 0 && (s >= 0 ? 1 : -1) !== (samples[start + i - 1] >= 0 ? 1 : -1)) zeroCrossings++;
    }
    const rms = Math.sqrt(sum / FRAME);
    frames.push(rms);
    if (rms < SILENCE) {
      prevMag = null;
      continue;
    }

    for (let i = 0; i < FRAME; i++) {
      re[i] = frameBuf[i] * window[i];
      im[i] = 0;
    }
    fft(re, im);

    const bins = FRAME / 2;
    const mag = new Float32Array(bins);
    let magSum = 0;
    let weighted = 0;
    let logSum = 0;
    let speech = 0;
    for (let k = 0; k < bins; k++) {
      const m = Math.hypot(re[k], im[k]);
      mag[k] = m;
      const hz = (k * sampleRate) / FRAME;
      magSum += m;
      weighted += m * hz;
      logSum += Math.log(m + 1e-9);
      if (hz >= 300 && hz <= 3400) speech += m;
    }
    if (magSum <= 0) {
      prevMag = null;
      continue;
    }

    centroidAcc += weighted / magSum;
    speechAcc += speech / magSum;
    const geo = Math.exp(logSum / bins);
    flatnessAcc += clamp01(geo / (magSum / bins));

    let cum = 0;
    let rolloffHz = sampleRate / 2;
    for (let k = 0; k < bins; k++) {
      cum += mag[k];
      if (cum >= 0.85 * magSum) {
        rolloffHz = (k * sampleRate) / FRAME;
        break;
      }
    }
    rolloffAcc += rolloffHz;

    if (prevMag) {
      let f = 0;
      for (let k = 0; k < bins; k++) {
        const d = mag[k] - prevMag[k];
        if (d > 0) f += d;
      }
      flux.push(f / magSum);
    }
    prevMag = mag;

    voicingAcc += frameVoicing(frameBuf, sampleRate);
    spectralFrames++;
  }

  const loud = frames.filter((f) => f >= SILENCE);
  const meanRms = loud.length ? loud.reduce((a, b) => a + b, 0) / loud.length : 0;
  const sorted = [...loud].sort((a, b) => a - b);
  const p10 = sorted.length ? sorted[Math.floor(sorted.length * 0.1)] : 0;
  const p90 = sorted.length ? sorted[Math.floor(sorted.length * 0.9)] : 0;

  // Onsets: flux peaks above mean + 1 sd.
  let onsets = 0;
  if (flux.length > 4) {
    const mean = flux.reduce((a, b) => a + b, 0) / flux.length;
    const sd = Math.sqrt(flux.reduce((a, b) => a + (b - mean) ** 2, 0) / flux.length);
    const thresh = mean + sd;
    for (let i = 1; i < flux.length - 1; i++) {
      if (flux[i] > thresh && flux[i] >= flux[i - 1] && flux[i] > flux[i + 1]) onsets++;
    }
  }
  const measuredSec = Math.max(1e-6, (spectralFrames * HOP) / sampleRate);

  return {
    durationSec: Math.round(durationSec * 100) / 100,
    sampleRate,
    rms: Math.round(clamp01(meanRms) * 1000) / 1000,
    dynamicRange: Math.round(clamp01(p90 - p10) * 1000) / 1000,
    centroidHz: Math.round(spectralFrames ? centroidAcc / spectralFrames : 0),
    flatness: Math.round((spectralFrames ? flatnessAcc / spectralFrames : 0) * 1000) / 1000,
    rolloffHz: Math.round(spectralFrames ? rolloffAcc / spectralFrames : 0),
    zeroCrossRate: Math.round(zeroCrossings / Math.max(1e-6, durationSec)),
    speechBandRatio: Math.round((spectralFrames ? speechAcc / spectralFrames : 0) * 1000) / 1000,
    voicing: Math.round((spectralFrames ? voicingAcc / spectralFrames : 0) * 1000) / 1000,
    onsetRate: Math.round((onsets / measuredSec) * 100) / 100,
    activity: Math.round((frames.length ? loud.length / frames.length : 0) * 1000) / 1000,
  };
}

/**
 * Feature → six-axis mapping. Each axis is a weighted blend of measured signal
 * traits, held inside 8..97 so nothing reads as certain.
 */
export function audioFingerprint(features: AudioFeatures): AudioFingerprint {
  const f = features;
  const brightness = scale(f.centroidHz, 300, 6000);
  const noisiness = clamp01(f.flatness * 1.6);
  const busy = scale(f.onsetRate, 0.2, 6);
  const speech = clamp01(f.speechBandRatio);
  const voiced = clamp01(f.voicing);
  const dyn = scale(f.dynamicRange, 0.01, 0.35);
  const body = scale(f.rolloffHz, 1500, 11000);
  const level = scale(f.rms, 0.01, 0.3);

  const axes: Record<ResonanceAxis, number> = {
    // Feeling tracks dynamics and warmth: loud, swelling, tonal audio reads high.
    emotional: 0.4 * dyn + 0.25 * level + 0.2 * voiced + 0.15 * (1 - noisiness),
    // Thinking tracks steady, mid-forward, speech-like detail without much churn.
    cognitive: 0.4 * speech + 0.25 * (1 - busy) + 0.2 * voiced + 0.15 * (1 - dyn),
    // Being with others tracks busy, broadband, noisy energy — rooms and crowds.
    social: 0.4 * busy + 0.3 * noisiness + 0.2 * body + 0.1 * level,
    // Being told something tracks the speech band and voiced periodicity.
    communication: 0.5 * speech + 0.3 * voiced + 0.2 * (1 - brightness),
    // Where it is tracks background bed: noise floor, wide spectrum, low dynamics.
    contextual: 0.35 * noisiness + 0.3 * body + 0.2 * (1 - dyn) + 0.15 * f.activity,
    // Craft tracks tonal brightness, rhythmic shape and range together.
    artistic: 0.35 * (1 - noisiness) + 0.25 * busy + 0.2 * brightness + 0.2 * dyn,
  };

  const scores = {} as Record<ResonanceAxis, number>;
  for (const axis of RESONANCE_AXES) {
    scores[axis] = Math.round(Math.min(97, Math.max(8, axes[axis] * 100)));
  }

  const lengthAdequacy = scale(f.durationSec, 1, 15);
  return {
    scores,
    features: f,
    engine: "on-device-audio",
    confidence: Math.round(clamp01(0.65 * f.activity + 0.35 * lengthAdequacy) * 100) / 100,
  };
}

/** Downmix every channel of a decoded buffer to mono. */
export function toMono(buffer: AudioBuffer): Float32Array {
  const out = new Float32Array(buffer.length);
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const data = buffer.getChannelData(c);
    for (let i = 0; i < data.length; i++) out[i] += data[i];
  }
  if (buffer.numberOfChannels > 1) {
    for (let i = 0; i < out.length; i++) out[i] /= buffer.numberOfChannels;
  }
  return out;
}

/** Longest stretch of audio measured in the browser, to keep it responsive. */
const MAX_ANALYSIS_SEC = 60;

/**
 * Decode an audio file in this browser and measure it. Runs entirely locally:
 * the file never leaves the device for this step.
 */
export async function encodeAudioFile(file: File | Blob): Promise<AudioFingerprint> {
  const Ctx: typeof AudioContext =
    (window as unknown as { AudioContext: typeof AudioContext }).AudioContext ??
    (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  if (!Ctx) throw new Error("This browser can't decode audio here.");

  const ctx = new Ctx();
  try {
    const bytes = await file.arrayBuffer();
    const buffer = await ctx.decodeAudioData(bytes.slice(0));
    let mono = toMono(buffer);
    const cap = Math.floor(MAX_ANALYSIS_SEC * buffer.sampleRate);
    if (mono.length > cap) mono = mono.subarray(0, cap);
    const features = extractAudioFeatures(mono, buffer.sampleRate);
    if (features.activity === 0) throw new Error("That file sounds silent all the way through.");
    return audioFingerprint(features);
  } finally {
    void ctx.close();
  }
}
