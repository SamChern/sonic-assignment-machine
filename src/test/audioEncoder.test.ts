import { describe, expect, it } from "vitest";
import {
  audioFingerprint,
  extractAudioFeatures,
  type AudioFeatures,
} from "@/lib/nextlevel/audioEncoder";
import { RESONANCE_AXES } from "@/lib/nextlevel/resonance";

const SR = 22050;

function tone(hz: number, seconds = 2, amp = 0.5): Float32Array {
  const out = new Float32Array(Math.floor(SR * seconds));
  for (let i = 0; i < out.length; i++) out[i] = amp * Math.sin((2 * Math.PI * hz * i) / SR);
  return out;
}

function noise(seconds = 2, amp = 0.5): Float32Array {
  const out = new Float32Array(Math.floor(SR * seconds));
  let seed = 12345;
  for (let i = 0; i < out.length; i++) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    out[i] = amp * (seed / 0x3fffffff - 1);
  }
  return out;
}

describe("on-device audio encoder", () => {
  it("measures a pure tone as tonal, low-noise and correctly bright", () => {
    const f = extractAudioFeatures(tone(440), SR);
    expect(f.durationSec).toBeCloseTo(2, 1);
    expect(f.centroidHz).toBeGreaterThan(300);
    expect(f.centroidHz).toBeLessThan(1500);
    expect(f.flatness).toBeLessThan(0.2);
    expect(f.voicing).toBeGreaterThan(0.5);
    expect(f.activity).toBeGreaterThan(0.9);
  });

  it("separates noise from a tone on noisiness and brightness", () => {
    const t = extractAudioFeatures(tone(440), SR);
    const n = extractAudioFeatures(noise(), SR);
    expect(n.flatness).toBeGreaterThan(t.flatness);
    expect(n.centroidHz).toBeGreaterThan(t.centroidHz);
    expect(n.zeroCrossRate).toBeGreaterThan(t.zeroCrossRate);
  });

  it("reports silence as inactive", () => {
    const f = extractAudioFeatures(new Float32Array(SR * 2), SR);
    expect(f.activity).toBe(0);
    expect(f.rms).toBe(0);
  });

  it("scores every axis within bounds and deterministically", () => {
    const f = extractAudioFeatures(tone(880), SR);
    const a = audioFingerprint(f);
    const b = audioFingerprint(f);
    for (const axis of RESONANCE_AXES) {
      expect(a.scores[axis]).toBeGreaterThanOrEqual(8);
      expect(a.scores[axis]).toBeLessThanOrEqual(97);
      expect(a.scores[axis]).toBe(b.scores[axis]);
    }
    expect(a.engine).toBe("on-device-audio");
    expect(a.confidence).toBeGreaterThan(0);
  });

  it("gives speech-band energy a higher communication score than a wideband hiss", () => {
    const speechish: AudioFeatures = {
      ...extractAudioFeatures(tone(700), SR),
      speechBandRatio: 0.85,
      voicing: 0.8,
    };
    const hissy: AudioFeatures = {
      ...extractAudioFeatures(noise(), SR),
      speechBandRatio: 0.2,
      voicing: 0.05,
    };
    expect(audioFingerprint(speechish).scores.communication).toBeGreaterThan(
      audioFingerprint(hissy).scores.communication,
    );
  });
});
