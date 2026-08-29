// Deterministic measurement holdout (Step 11c).
//
// Every cohort withholds a slice of its members from the activation file so
// pixel events split into exposed vs. holdout and `activation-lift` can report
// lift instead of correlation. The split must be:
//   * deterministic  — the same member is always in the same arm, so a re-run
//                      or a rebuilt cohort never reshuffles the experiment;
//   * per-cohort     — the slug is part of the hash, so one subject is not
//                      permanently excluded from every cohort it lands in;
//   * writer-agnostic — the nightly cohort builder and the Predict-Users
//                      "Save run" path share this one rule.

import { controlNumber } from "./control.ts";

/** FNV-1a over UTF-16 code units — small, stable, no crypto needed. */
export function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** Registry-backed holdout share (`activation.holdout_pct`), clamped 0–0.5. */
export async function holdoutPct(
  // deno-lint-ignore no-explicit-any
  admin: any,
  fallback = 0.1,
): Promise<number> {
  return await controlNumber(admin, "activation.holdout_pct", fallback, { min: 0, max: 0.5 });
}

/**
 * Is this member in the cohort's holdout arm?
 * Buckets the hash into 1000 slots so a 10% share means slots 0–99.
 */
export function isHoldout(slug: string, subjectKey: string, pct: number): boolean {
  if (!(pct > 0)) return false;
  return fnv1a(`${slug}:${subjectKey}`) % 1000 < Math.round(pct * 1000);
}

/** Convenience for bulk writers: tag each key with its arm. */
export function assignHoldout<T extends string>(
  slug: string,
  keys: readonly T[],
  pct: number,
): { key: T; holdout: boolean }[] {
  return keys.map((key) => ({ key, holdout: isHoldout(slug, key, pct) }));
}
