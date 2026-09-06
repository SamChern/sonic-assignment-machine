import { describe, expect, it } from "vitest";
import { audioFingerprint, type AudioFeatures } from "@/lib/nextlevel/audioEncoder";
import {
  axesFromFeatures,
  featureConfidence,
  resonancePoint as serverResonance,
  sanitizeFeatures,
} from "../../supabase/functions/_shared/audioFingerprint";
import { resonancePoint } from "@/lib/nextlevel/resonance";

/**
 * The browser measures, the backend decides what the numbers mean. If the two
 * mappings ever drift, published scores stop being reproducible — so this test
 * pins them together.
 */
const sample = (over: Partial<AudioFeatures> = {}): AudioFeatures => ({
  durationSec: 24,
  sampleRate: 48000,
  rms: 0.12,
  dynamicRange: 0.18,
  centroidHz: 2400,
  flatness: 0.31,
  rolloffHz: 6200,
  zeroCrossRate: 4100,
  speechBandRatio: 0.44,
  voicing: 0.62,
  onsetRate: 2.4,
  activity: 0.86,
  ...over,
});

describe("browser/server encoder parity", () => {
  it("derives identical axis scores and confidence", () => {
    for (const features of [
      sample(),
      sample({ speechBandRatio: 0.9, voicing: 0.95, onsetRate: 0.3 }),
      sample({ flatness: 0.8, onsetRate: 7, dynamicRange: 0.02 }),
      sample({ durationSec: 2, activity: 0.2, rms: 0.01 }),
    ]) {
      const local = audioFingerprint(features);
      expect(axesFromFeatures(features)).toEqual(local.scores);
      expect(featureConfidence(features)).toBe(local.confidence);
    }
  });

  it("computes the same match score on both sides", () => {
    const features = sample();
    const audience = {
      emotional: 55,
      cognitive: 60,
      social: 58,
      communication: 52,
      contextual: 70,
      artistic: 48,
    };
    const scores = axesFromFeatures(features);
    expect(serverResonance(scores, audience).score).toBe(resonancePoint(scores, audience).score);
  });

  it("clamps impossible measurements from a client", () => {
    const dirty = sanitizeFeatures({
      durationSec: -5,
      rms: 42,
      flatness: "nonsense",
      activity: 1.7,
    });
    expect(dirty.durationSec).toBe(0);
    expect(dirty.rms).toBe(1);
    expect(dirty.flatness).toBe(0);
    expect(dirty.activity).toBe(1);
  });
});
