/**
 * Step 10 verification harness.
 *
 *  * the trail keys on media time, dedupes and stays bounded;
 *  * the accumulated live windows agree with the stored `source_analyses` row
 *    within tolerance, so drift in the scoring path fails CI;
 *  * silhouettes stay byte-deterministic and diverge on the expected axes.
 */
import { describe, expect, it } from "vitest";
import {
  appendTrailEntry,
  axisAgreement,
  formatTrailTime,
  nearestEntry,
  trailMeanAxes,
  trailPosition,
  TRAIL_LIMIT,
  type TrailEntry,
} from "@/lib/audioscope/trail";
import { createSilhouetteSignal, silhouetteDivergence } from "@/lib/audioscope/silhouette";
import { analysisToScores, emptyScores, type CategoryScores } from "@/lib/audioscope";

function entry(t: number, axes: Partial<CategoryScores> = {}): TrailEntry {
  return {
    t,
    scopeT: t,
    tags: [{ code: "aset.music", label: "Music", similarity: 0.8 }],
    axes: { ...emptyScores(), emotional: 70, communication: 60, artistic: 40, ...axes },
    features: { rms: 0.4, centroidHz: 1800 },
  };
}

describe("tag-fire trail", () => {
  it("keys on media time, sorts, dedupes and stays bounded", () => {
    let trail: TrailEntry[] = [];
    trail = appendTrailEntry(trail, entry(10));
    trail = appendTrailEntry(trail, entry(5));
    trail = appendTrailEntry(trail, entry(10.001)); // same moment, rescored
    expect(trail.map((e) => e.t)).toEqual([5, 10.001]);

    for (let i = 0; i < TRAIL_LIMIT + 10; i++) trail = appendTrailEntry(trail, entry(100 + i));
    expect(trail).toHaveLength(TRAIL_LIMIT);
  });

  it("finds the entry nearest a scrub target", () => {
    const trail = [entry(5), entry(42), entry(90)];
    expect(nearestEntry(trail, 41.2)?.t).toBe(42);
    expect(nearestEntry(trail, 200, 5)).toBeNull();
  });

  it("positions markers across the strip and formats media time", () => {
    expect(trailPosition(entry(30), 60)).toBeCloseTo(0.5, 5);
    expect(trailPosition(entry(90), 60)).toBe(1);
    expect(formatTrailTime(42)).toBe("0:42");
    expect(formatTrailTime(125)).toBe("2:05");
  });
});

describe("live radial vs stored analysis", () => {
  const stored = analysisToScores({
    emotional_score: 72,
    cognitive_score: 44,
    social_score: 51,
    communication_score: 63,
    contextual_score: 38,
    artistic_score: 46,
  });

  it("agrees within tolerance when the scoring path is healthy", () => {
    const trail = [
      entry(5, { emotional: 70, cognitive: 40, social: 48, communication: 60, contextual: 35, artistic: 44 }),
      entry(10, { emotional: 76, cognitive: 48, social: 55, communication: 66, contextual: 42, artistic: 50 }),
    ];
    const live = trailMeanAxes(trail)!;
    const result = axisAgreement(live, stored, 12);
    expect(result.agrees).toBe(true);
    expect(result.maxDelta).toBeLessThanOrEqual(12);
  });

  it("fails when an axis drifts beyond tolerance", () => {
    const live = { ...stored, communication: 10 };
    const result = axisAgreement(live, stored, 12);
    expect(result.agrees).toBe(false);
    expect(result.axes.find((a) => a.category === "communication")?.withinTolerance).toBe(false);
  });

  it("reports no mean for an empty trail", () => {
    expect(trailMeanAxes([])).toBeNull();
  });
});

describe("silhouette determinism", () => {
  const scores: CategoryScores = { ...emptyScores(), emotional: 70, communication: 60, artistic: 40 };
  const tags = [
    { code: "aset.speech", weight: 0.8 },
    { code: "aset.music", weight: 0.4 },
  ];

  function trace(seed: string, s: CategoryScores, t = tags): number[] {
    const signal = createSilhouetteSignal({ scores: s, tags: t, seed });
    const buf = new Float32Array(256);
    const out: number[] = [];
    for (const time of [0, 0.5, 1.25]) {
      signal.waveform(buf, time);
      out.push(...Array.from(buf));
    }
    signal.dispose();
    return out;
  }

  it("produces an identical trace for identical inputs", () => {
    expect(trace("subject-a", scores)).toEqual(trace("subject-a", scores));
  });

  it("differs for a different subject and flags the divergent axes", () => {
    const other: CategoryScores = { ...scores, communication: 20, cognitive: 80 };
    expect(trace("subject-a", scores)).not.toEqual(trace("subject-a", other));

    const { axes, similarity } = silhouetteDivergence(scores, other);
    const divergent = axes.filter((a) => a.divergent).map((a) => a.category).sort();
    expect(divergent).toEqual(["cognitive", "communication"]);
    expect(similarity).toBeLessThan(100);
  });
});
