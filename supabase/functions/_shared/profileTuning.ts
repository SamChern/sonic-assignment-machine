// Activation profile score tuning from the CLAP vector.
//
// `build_activation_profile` averages the six scores of the identifiers in an
// activation. Those identifier scores are text-only: they come from taxonomy
// tag sets, never from audio. Once the activation profile has a vector in CLAP
// space (see clap-ground-audio) we can do better: retrieve the nearest
// *audio-grounded* sources — rows someone actually listened to — and pull the
// profile's scores toward what that audio evidence says, raising confidence in
// proportion to how much the neighbours agree.
//
// Enrichment only. No vector, no grounded neighbours, or a weak match => the
// text-derived numbers stand untouched.

import { controlNumber } from "./control.ts";

export const CATEGORY_KEYS = [
  "emotional",
  "cognitive",
  "social",
  "communication",
  "contextual",
  "artistic",
] as const;
export type CategoryKey = typeof CATEGORY_KEYS[number];
export type Scores = Record<CategoryKey, number>;

export interface ProfileTuning {
  tuned: boolean;
  reason?: string;
  neighbours: number;
  avg_similarity: number;
  weight: number;
  agreement: number;
  scores_before?: Scores;
  scores_after?: Scores;
  confidence_before?: number;
  confidence_after?: number;
}

interface NeighbourRow {
  id: string;
  name: string | null;
  similarity: number;
  confidence: number | null;
  emotional_score: number | null;
  cognitive_score: number | null;
  social_score: number | null;
  communication_score: number | null;
  contextual_score: number | null;
  artistic_score: number | null;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const clampScore = (v: number) => Math.round(clamp(v, 0, 100));

/** Vectors come back from postgres as a `[1,2,3]` string (or already parsed). */
export function parseEmbedding(raw: unknown): number[] | null {
  if (Array.isArray(raw)) {
    const nums = raw.map(Number).filter((n) => Number.isFinite(n));
    return nums.length ? nums : null;
  }
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parseEmbedding(parsed) : null;
    } catch {
      return null;
    }
  }
  return null;
}

function scoresOf(row: Record<string, unknown>): Scores {
  const out = {} as Scores;
  for (const c of CATEGORY_KEYS) out[c] = Number(row[`${c}_score`] ?? 0) || 0;
  return out;
}

/**
 * Pull one activation profile's six scores toward its audio-grounded
 * neighbours. Returns what happened so the caller can show it.
 */
export async function tuneActivationProfileScores(
  // deno-lint-disable-next-line no-explicit-any
  admin: any,
  sourceId: string,
  activationId: string,
): Promise<ProfileTuning> {
  const idle = (reason: string): ProfileTuning => ({
    tuned: false,
    reason,
    neighbours: 0,
    avg_similarity: 0,
    weight: 0,
    agreement: 0,
  });

  const { data: srcRow } = await admin
    .from("audio_sources")
    .select("profile_embedding")
    .eq("id", sourceId)
    .maybeSingle();
  const vector = parseEmbedding(srcRow?.profile_embedding);
  if (!vector) return idle("the activation profile has no grounded vector yet");

  const { data: anaRow } = await admin
    .from("source_analyses")
    .select(
      "id, confidence, grounding_level, raw_scores, emotional_score, cognitive_score, social_score, communication_score, contextual_score, artistic_score",
    )
    .eq("audio_source_id", sourceId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!anaRow) return idle("the activation profile has no scores to tune yet");

  const [maxWeight, minSim, wantNeighbours, confCap, confBoost] = await Promise.all([
    controlNumber(admin, "clap.profile_tune_weight", 0.35, { min: 0, max: 0.8 }),
    controlNumber(admin, "clap.profile_tune_min_similarity", 0.15, { min: 0, max: 1 }),
    controlNumber(admin, "clap.profile_tune_neighbours", 8, { min: 1, max: 30 }),
    controlNumber(admin, "clap.profile_tune_confidence_cap", 0.9, { min: 0.5, max: 0.99 }),
    controlNumber(admin, "clap.profile_tune_confidence_boost", 0.25, { min: 0, max: 0.5 }),
  ]);
  if (maxWeight <= 0) return idle("profile tuning is switched off in the Control Room");

  const { data: knn, error } = await admin.rpc("match_grounded_audio_profiles", {
    query_embedding: JSON.stringify(vector),
    match_count: Math.round(wantNeighbours),
    exclude_id: sourceId,
  });
  if (error) return idle(`neighbour lookup failed: ${error.message}`);

  const neighbours = ((knn ?? []) as NeighbourRow[]).filter(
    (n) => Number(n.similarity) >= minSim,
  );
  if (neighbours.length === 0) {
    return idle("no audio-grounded neighbours are close enough to this audience yet");
  }

  const before = scoresOf(anaRow as Record<string, unknown>);
  const confBefore = clamp(Number(anaRow.confidence ?? 0.5) || 0.5, 0, 1);

  // Similarity-weighted neighbour mean, per category.
  const totalSim = neighbours.reduce((s, n) => s + Number(n.similarity), 0);
  const audio = {} as Scores;
  for (const c of CATEGORY_KEYS) {
    audio[c] = neighbours.reduce(
      (s, n) => s + (Number(n[`${c}_score`] ?? 0) || 0) * Number(n.similarity),
      0,
    ) / (totalSim || 1);
  }

  const avgSim = totalSim / neighbours.length;
  // How much the neighbours agree: mean per-category spread, mapped to 0..1.
  const spread = CATEGORY_KEYS.reduce((sum, c) => {
    const vals = neighbours.map((n) => Number(n[`${c}_score`] ?? 0) || 0);
    const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
    const sd = Math.sqrt(vals.reduce((a, b) => a + (b - mean) ** 2, 0) / vals.length);
    return sum + sd;
  }, 0) / CATEGORY_KEYS.length;
  const agreement = clamp(1 - spread / 40, 0, 1);

  // Trust the audio more when it is a close match, plentiful and consistent.
  const weight = clamp(
    maxWeight * avgSim * agreement * Math.min(1, neighbours.length / 3),
    0,
    maxWeight,
  );
  if (weight <= 0.01) return idle("the audio evidence is too weak to move the scores");

  const after = {} as Scores;
  for (const c of CATEGORY_KEYS) {
    after[c] = clampScore((1 - weight) * before[c] + weight * audio[c]);
  }
  const confAfter = Math.min(
    confCap,
    Math.round((confBefore + confBoost * weight * agreement) * 1000) / 1000,
  );

  const rawBefore = (anaRow.raw_scores ?? {}) as Record<string, unknown>;
  const { error: upErr } = await admin
    .from("source_analyses")
    .update({
      emotional_score: after.emotional,
      cognitive_score: after.cognitive,
      social_score: after.social,
      communication_score: after.communication,
      contextual_score: after.contextual,
      artistic_score: after.artistic,
      confidence: confAfter,
      grounding_level: "grounded",
      raw_scores: {
        ...rawBefore,
        clap_tuning: {
          activation_id: activationId,
          tuned_at: new Date().toISOString(),
          neighbours: neighbours.map((n) => ({
            id: n.id,
            name: n.name,
            similarity: Math.round(Number(n.similarity) * 1000) / 1000,
          })),
          weight: Math.round(weight * 1000) / 1000,
          agreement: Math.round(agreement * 1000) / 1000,
          avg_similarity: Math.round(avgSim * 1000) / 1000,
          text_only_scores: before,
          audio_neighbour_scores: Object.fromEntries(
            CATEGORY_KEYS.map((c) => [c, Math.round(audio[c])]),
          ),
          confidence_before: confBefore,
        },
      },
    })
    .eq("id", anaRow.id);
  if (upErr) return idle(`could not save the tuned scores: ${upErr.message}`);

  return {
    tuned: true,
    neighbours: neighbours.length,
    avg_similarity: Math.round(avgSim * 1000) / 1000,
    weight: Math.round(weight * 1000) / 1000,
    agreement: Math.round(agreement * 1000) / 1000,
    scores_before: before,
    scores_after: after,
    confidence_before: confBefore,
    confidence_after: confAfter,
  };
}
