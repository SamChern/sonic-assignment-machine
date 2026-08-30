/**
 * Step 14b — "honest scores".
 *
 * Every analysis records HOW it knew, not just what it scored:
 *   grounded  — real measured audio was involved (librosa/provider features, or
 *               a taxonomy node whose vector came from listened-to sample audio).
 *   bridged   — no measured audio for this subject, but its taxonomy vectors
 *               were carried into the catalog space (bridge/pad) and/or scored
 *               against measured neighbours.
 *   text-only — label semantics only. The weakest claim we can make.
 */

export type GroundingLevel = "text-only" | "bridged" | "grounded";

export const GROUNDING_LEVELS: GroundingLevel[] = ["text-only", "bridged", "grounded"];

const RANK: Record<GroundingLevel, number> = {
  "text-only": 0,
  bridged: 1,
  grounded: 2,
};

/** Keeps the strongest honest claim of two observations. */
export function strongestGrounding(a: GroundingLevel, b: GroundingLevel): GroundingLevel {
  return RANK[a] >= RANK[b] ? a : b;
}

export interface GroundingInputs {
  /** Evidence tier resolved by the analyzer. */
  evidence?: string | null;
  /** A tag node backed by listened-to sample audio contributed to the subject. */
  groundedTag?: boolean;
  /** Tag vectors were bridged or padded into the catalog space. */
  bridged?: boolean;
  /** Measured neighbours were retrieved as exemplars. */
  neighbors?: boolean;
}

/**
 * Resolve the level from what the pipeline actually had on hand. Deliberately
 * conservative: anything unproven falls back to `text-only`.
 */
export function resolveGroundingLevel(input: GroundingInputs): GroundingLevel {
  const evidence = (input.evidence ?? "").toLowerCase();
  if (evidence === "librosa" || evidence === "provider" || input.groundedTag) {
    return "grounded";
  }
  if (input.bridged || input.neighbors || evidence === "neighbors") {
    return "bridged";
  }
  return "text-only";
}

/** True when a taxonomy node's vector came from listened-to audio. */
export function nodeIsGrounded(node: { grounding_count?: number | null; audio_embedding?: unknown }): boolean {
  return Number(node?.grounding_count ?? 0) > 0 && node?.audio_embedding != null;
}

export function groundingLabel(level: GroundingLevel): string {
  if (level === "grounded") return "Grounded";
  if (level === "bridged") return "Bridged";
  return "Text-only";
}
