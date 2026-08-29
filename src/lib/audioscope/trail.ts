/**
 * The tag-fire trail — the Semantic Scope's memory.
 *
 * Each scored window is recorded against *media time* (not frame count), so the
 * trail survives pause, seek and speed changes: scrub back to 0:42 and you get
 * exactly the tags, axes and features the model saw at 0:42.
 *
 * Pure functions only — no React, no canvas — so the trail can be asserted in
 * tests and reused by the enterprise wavesurfer inspector.
 */
import type { ScopeFeatures } from "./features";
import { AUDIOSCOPE_CATEGORIES, type CategoryScores } from "./types";

export interface TrailTag {
  code: string;
  label: string;
  similarity: number;
}

export interface TrailEntry {
  /** Media time in seconds when the window closed (the seek target). */
  t: number;
  /** Scope timeline seconds — used when the signal has no seekable media. */
  scopeT: number;
  tags: TrailTag[];
  axes: CategoryScores;
  features: { rms: number; centroidHz: number };
}

/** Trail history is bounded; the strip only ever shows recent windows. */
export const TRAIL_LIMIT = 40;

export function appendTrailEntry(prev: TrailEntry[], entry: TrailEntry): TrailEntry[] {
  const next = [...prev.filter((e) => Math.abs(e.t - entry.t) > 0.01), entry];
  next.sort((a, b) => a.t - b.t);
  return next.slice(-TRAIL_LIMIT);
}

/** The entry nearest a given media time, within `tolerance` seconds. */
export function nearestEntry(
  trail: TrailEntry[],
  t: number,
  tolerance = Number.POSITIVE_INFINITY,
): TrailEntry | null {
  let best: TrailEntry | null = null;
  let bestD = Number.POSITIVE_INFINITY;
  for (const e of trail) {
    const d = Math.abs(e.t - t);
    if (d < bestD) {
      bestD = d;
      best = e;
    }
  }
  return best && bestD <= tolerance ? best : null;
}

/** Marker position 0..1 across the strip. */
export function trailPosition(entry: TrailEntry, span: number): number {
  if (!(span > 0)) return 0;
  const p = entry.t / span;
  return p < 0 ? 0 : p > 1 ? 1 : p;
}

export function formatTrailTime(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** Mean of every scored window, per axis — what the scope heard overall. */
export function trailMeanAxes(trail: TrailEntry[]): CategoryScores | null {
  if (!trail.length) return null;
  const out = {} as CategoryScores;
  for (const c of AUDIOSCOPE_CATEGORIES) {
    out[c] = trail.reduce((s, e) => s + (Number(e.axes[c]) || 0), 0) / trail.length;
  }
  return out;
}

export interface AxisAgreement {
  axes: { category: string; live: number; stored: number; delta: number; withinTolerance: boolean }[];
  maxDelta: number;
  agrees: boolean;
}

/**
 * Does the live meaning lens agree with the stored `source_analyses` row?
 * Used by CI to catch drift in the scoring path (Step 10 verification).
 */
export function axisAgreement(
  live: CategoryScores,
  stored: CategoryScores,
  tolerance = 12,
): AxisAgreement {
  const axes = AUDIOSCOPE_CATEGORIES.map((category) => {
    const l = Number(live[category]) || 0;
    const s = Number(stored[category]) || 0;
    const delta = Math.abs(l - s);
    return { category, live: l, stored: s, delta, withinTolerance: delta <= tolerance };
  });
  const maxDelta = axes.reduce((m, a) => Math.max(m, a.delta), 0);
  return { axes, maxDelta, agrees: axes.every((a) => a.withinTolerance) };
}
