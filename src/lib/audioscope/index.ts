import { AUDIOSCOPE_CATEGORIES, emptyScores, type CategoryScores } from "./types";

export * from "./types";
export { createSyntheticSignal } from "./synthetic";
export { createLiveAudioSignal } from "./liveAudio";
export * from "./preference";

/** Map a `user_fingerprints` row (…_avg / …_avg_recent) into category scores. */
export function fingerprintToScores(
  fp: Record<string, unknown> | null | undefined,
  mode: "all" | "recent" = "all",
): CategoryScores {
  const out = emptyScores();
  if (!fp) return out;
  for (const c of AUDIOSCOPE_CATEGORIES) {
    const key = mode === "recent" ? `${c}_avg_recent` : `${c}_avg`;
    const value = Number(fp[key]);
    const fallback = Number(fp[`${c}_avg`]);
    out[c] = Number.isFinite(value) && value > 0 ? value : Number.isFinite(fallback) ? fallback : 0;
  }
  return out;
}

/** Map a `source_analyses` row (…_score) into category scores. */
export function analysisToScores(row: Record<string, unknown> | null | undefined): CategoryScores {
  const out = emptyScores();
  if (!row) return out;
  for (const c of AUDIOSCOPE_CATEGORIES) {
    const value = Number(row[`${c}_score`]);
    out[c] = Number.isFinite(value) ? value : 0;
  }
  return out;
}

/** CSS variable holding the semantic color for a category. */
export function categoryToken(category: string): string {
  return `hsl(var(--category-${category}))`;
}

export const CATEGORY_LABELS: Record<string, string> = {
  emotional: "Emotional",
  cognitive: "Cognitive",
  social: "Social",
  communication: "Communication",
  contextual: "Contextual",
  artistic: "Artistic",
};
