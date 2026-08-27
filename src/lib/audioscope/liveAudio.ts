import {
  AUDIOSCOPE_CATEGORIES,
  clamp01,
  emptyScores,
  type AudioscopeSignal,
} from "./types";

let sharedCtx: AudioContext | null = null;
const connected = new WeakMap<HTMLMediaElement, MediaElementAudioSourceNode>();

function getCtx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const Ctor = window.AudioContext || (window as any).webkitAudioContext;
  if (!Ctor) return null;
  // Created on user gesture only — callers invoke this from a click handler.
  if (!sharedCtx || sharedCtx.state === "closed") sharedCtx = new Ctor();
  if (sharedCtx.state === "suspended") void sharedCtx.resume();
  return sharedCtx;
}

/**
 * Real-audio scope: routes a media element through an AnalyserNode, exactly
 * like the reference oscilloscope, and exposes the same interface as the
 * synthetic signal. Returns null when Web Audio is unavailable or the source
 * is cross-origin-tainted (caller then falls back to the synthetic scope).
 */
export function createLiveAudioSignal(el: HTMLMediaElement): AudioscopeSignal | null {
  const ctx = getCtx();
  if (!ctx) return null;

  let analyser: AnalyserNode;
  try {
    let src = connected.get(el);
    if (!src) {
      src = ctx.createMediaElementSource(el);
      connected.set(el, src);
    }
    analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    analyser.smoothingTimeConstant = 0.75;
    src.connect(analyser);
    src.connect(ctx.destination);
  } catch {
    return null;
  }

  const time = new Uint8Array(analyser.fftSize);
  const freq = new Uint8Array(analyser.frequencyBinCount);

  return {
    kind: "live",
    waveform(out) {
      analyser.getByteTimeDomainData(time);
      const n = out.length;
      for (let i = 0; i < n; i++) {
        const idx = Math.floor((i / n) * time.length);
        out[i] = time[idx] / 128 - 1;
      }
    },
    spectrum(out) {
      analyser.getByteFrequencyData(freq);
      const n = out.length;
      for (let i = 0; i < n; i++) {
        const idx = Math.floor((i / n) * freq.length);
        out[i] = freq[idx] / 255;
      }
    },
    bands() {
      analyser.getByteFrequencyData(freq);
      const res = emptyScores();
      const per = Math.max(1, Math.floor(freq.length / AUDIOSCOPE_CATEGORIES.length));
      AUDIOSCOPE_CATEGORIES.forEach((c, i) => {
        let sum = 0;
        for (let k = i * per; k < (i + 1) * per && k < freq.length; k++) sum += freq[k];
        res[c] = clamp01(sum / (per * 255));
      });
      return res;
    },
    dispose() {
      try {
        analyser.disconnect();
      } catch {
        /* already torn down */
      }
    },
  };
}
