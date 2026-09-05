import { describe, expect, it } from "vitest";
import {
  DEFAULT_RESONANCE_DEFINITION,
  RESONANCE_AXES,
  resonanceIndex,
  resonancePoint,
  resonanceWording,
} from "@/lib/nextlevel/resonance";
import { sensorySignature } from "@/lib/nextlevel/sensory";
import { onDeviceFingerprint } from "@/lib/nextlevel/onDeviceFingerprint";

const flat = (n: number) =>
  RESONANCE_AXES.reduce((acc, a) => ({ ...acc, [a]: n }), {} as Record<string, number>);

describe("resonance point", () => {
  it("scores an exact match at 100", () => {
    const r = resonancePoint(flat(60), flat(60));
    expect(r.score).toBe(100);
    expect(r.distance).toBe(0);
  });

  it("scores opposite corners at 0", () => {
    expect(resonancePoint(flat(0), flat(100)).score).toBe(0);
  });

  it("reports the axis pulling the score down", () => {
    const r = resonancePoint({ ...flat(50), communication: 95 }, flat(50));
    expect(r.weakestAxis).toBe("communication");
    expect(r.gaps.communication).toBe(45);
  });

  it("honours the stored weights", () => {
    const light = resonancePoint({ ...flat(50), artistic: 90 }, flat(50));
    const heavy = resonancePoint({ ...flat(50), contextual: 90 }, flat(50));
    // contextual carries 1.25, artistic 0.75, so the same gap costs more.
    expect(heavy.score).toBeLessThan(light.score);
    expect(heavy.definitionVersion).toBe(DEFAULT_RESONANCE_DEFINITION.version);
  });

  it("averages an index and words it plainly", () => {
    const idx = resonanceIndex([flat(60), flat(60)], flat(60));
    expect(idx).toEqual({ index: 100, count: 2 });
    expect(resonanceIndex([], flat(60)).count).toBe(0);
    expect(resonanceWording(90)).toBe("Very close match");
    expect(resonanceWording(10)).toBe("Weak match");
  });
});

describe("sensory signature", () => {
  it("is deterministic and stays inside the 3.5s window", () => {
    const v = { ...flat(55), cognitive: 80, social: 90 };
    const a = sensorySignature(v);
    const b = sensorySignature(v);
    expect(a).toEqual(b);
    expect(a.durationMs).toBeLessThanOrEqual(3500);
    expect(a.vibration.length).toBeGreaterThan(0);
    expect(a.vibration.length % 2).toBe(0);
    expect(a.bpm).toBeGreaterThanOrEqual(72);
    expect(a.bpm).toBeLessThanOrEqual(150);
  });

  it("pulses faster as the cognitive score rises", () => {
    expect(sensorySignature(flat(100)).bpm).toBeGreaterThan(sensorySignature(flat(0)).bpm);
  });
});

describe("on-device fingerprint", () => {
  it("lifts the axis the tags point at", () => {
    const r = onDeviceFingerprint([
      { code: "ctv.speech.interview", label: "spoken word interview" },
      { code: "podcast.dialog", label: "podcast dialogue" },
    ]);
    expect(r.scores.communication).toBeGreaterThan(r.scores.artistic);
    expect(r.coverage).toBe(1);
    expect(r.engine).toBe("on-device-text");
  });

  it("reports zero coverage for tags it does not recognise", () => {
    const r = onDeviceFingerprint([{ code: "zzz.qqq", label: "zzz" }]);
    expect(r.matchedTags).toBe(0);
    expect(r.coverage).toBe(0);
    for (const axis of RESONANCE_AXES) {
      expect(r.scores[axis]).toBeGreaterThanOrEqual(0);
      expect(r.scores[axis]).toBeLessThanOrEqual(100);
    }
  });

  it("handles an empty tag list without throwing", () => {
    expect(() => onDeviceFingerprint([])).not.toThrow();
  });
});
