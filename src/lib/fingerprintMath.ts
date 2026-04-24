// Shared fingerprint math utilities (similarity + drift)
// Used by FingerprintComparison, AggregateNetworkVisualization, TasteNeighbors

export const FINGERPRINT_CATEGORIES = [
  { key: "emotional_avg", recentKey: "emotional_avg_recent", name: "Emotional" },
  { key: "cognitive_avg", recentKey: "cognitive_avg_recent", name: "Cognitive" },
  { key: "social_avg", recentKey: "social_avg_recent", name: "Social" },
  { key: "communication_avg", recentKey: "communication_avg_recent", name: "Communication" },
  { key: "contextual_avg", recentKey: "contextual_avg_recent", name: "Contextual" },
  { key: "artistic_avg", recentKey: "artistic_avg_recent", name: "Artistic" },
] as const;

export type FingerprintMode = "all" | "recent";

export interface FingerprintLike {
  emotional_avg: number;
  cognitive_avg: number;
  social_avg: number;
  communication_avg: number;
  contextual_avg: number;
  artistic_avg: number;
  emotional_avg_recent?: number;
  cognitive_avg_recent?: number;
  social_avg_recent?: number;
  communication_avg_recent?: number;
  contextual_avg_recent?: number;
  artistic_avg_recent?: number;
}

export function getVector(fp: FingerprintLike, mode: FingerprintMode = "all"): number[] {
  return FINGERPRINT_CATEGORIES.map((c) => {
    const key = mode === "recent" ? c.recentKey : c.key;
    return Number((fp as any)[key]) || 0;
  });
}

// Hybrid similarity (cosine 30% + euclidean 70%) with sigmoid spread.
// Matches existing behavior used across the app.
export function calculateSimilarity(
  fp1: FingerprintLike,
  fp2: FingerprintLike,
  mode: FingerprintMode = "all",
): number {
  const v1 = getVector(fp1, mode);
  const v2 = getVector(fp2, mode);

  const dot = v1.reduce((s, v, i) => s + v * v2[i], 0);
  const m1 = Math.sqrt(v1.reduce((s, v) => s + v * v, 0));
  const m2 = Math.sqrt(v2.reduce((s, v) => s + v * v, 0));
  const cosine = m1 === 0 || m2 === 0 ? 0 : dot / (m1 * m2);

  const euclid = Math.sqrt(v1.reduce((s, v, i) => s + Math.pow(v - v2[i], 2), 0));
  const maxDist = Math.sqrt(FINGERPRINT_CATEGORIES.length * 100 * 100);
  const normalizedDist = euclid / maxDist;

  const hybrid = 0.3 * cosine + 0.7 * (1 - normalizedDist);
  return Math.max(0, Math.min(1, Math.pow(hybrid, 1.5)));
}

// Taste drift: normalized distance between all-time and recent vectors.
// Returns { distancePct: 0-100, dominantShiftCategory: name | null }
export function calculateDrift(fp: FingerprintLike): {
  distancePct: number;
  dominantShiftCategory: string | null;
  direction: "up" | "down" | "flat";
} {
  const allVec = getVector(fp, "all");
  const recVec = getVector(fp, "recent");

  // If no recent data, no drift
  if (recVec.every((v) => v === 0)) {
    return { distancePct: 0, dominantShiftCategory: null, direction: "flat" };
  }

  const euclid = Math.sqrt(allVec.reduce((s, v, i) => s + Math.pow(v - recVec[i], 2), 0));
  const maxDist = Math.sqrt(FINGERPRINT_CATEGORIES.length * 100 * 100);
  const distancePct = Math.min(100, (euclid / maxDist) * 100);

  // Find category with biggest absolute change
  let maxIdx = 0;
  let maxDelta = 0;
  recVec.forEach((v, i) => {
    const delta = v - allVec[i];
    if (Math.abs(delta) > Math.abs(maxDelta)) {
      maxDelta = delta;
      maxIdx = i;
    }
  });

  return {
    distancePct,
    dominantShiftCategory: FINGERPRINT_CATEGORIES[maxIdx].name,
    direction: maxDelta > 2 ? "up" : maxDelta < -2 ? "down" : "flat",
  };
}
