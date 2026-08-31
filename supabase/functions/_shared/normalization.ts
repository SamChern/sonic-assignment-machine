// Speech-skew normalization for the six-category ontology.
//
// Intuizi CTV / audio-app feeds skew heavily toward vocal and spoken-word
// signals, which inflates the Communication dimension (and, to a lesser
// degree, Cognitive) relative to music-driven sources. This module damps that
// inflation and — optionally — redistributes the removed mass across the other
// categories so the profile keeps its overall energy while losing the bias.

import { CATEGORIES, type Category } from "./ontology.ts";

export interface NormalizationConfig {
  scope: string;
  enabled: boolean;
  speech_bias: number; // 0 = no correction, 1 = maximum correction
  redistribute: boolean;
  gains: Record<string, number>;
}

export const DEFAULT_NORMALIZATION: NormalizationConfig = {
  scope: "global",
  enabled: false,
  speech_bias: 0,
  redistribute: true,
  gains: {
    emotional: 1,
    cognitive: 1,
    social: 1,
    communication: 1,
    contextual: 1,
    artistic: 1,
  },
};

/** How much of each category is treated as speech-driven inflation. */
const SPEECH_LOAD: Record<Category, number> = {
  emotional: 0.05,
  cognitive: 0.20,
  social: 0.10,
  communication: 0.60,
  contextual: 0.05,
  artistic: 0.15,
};

export interface NormalizationAudit {
  scope: string;
  enabled: boolean;
  speech_bias: number;
  redistribute: boolean;
  gains: Record<string, number>;
  deltas: Record<string, number>;
  applied_at: string;
}

/** Load the persisted config for a scope, falling back to `global`, then off. */
export async function loadNormalization(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  scope: string,
): Promise<NormalizationConfig> {
  try {
    const { data } = await supabase
      .from("semantic_normalization")
      .select("scope,enabled,speech_bias,redistribute,gains")
      .in("scope", [scope, "global"]);
    const rows = (data ?? []) as NormalizationConfig[];
    const exact = rows.find((r) => r.scope === scope);
    const global = rows.find((r) => r.scope === "global");
    const cfg = exact ?? global;
    if (!cfg) return DEFAULT_NORMALIZATION;
    return {
      scope: cfg.scope,
      enabled: !!cfg.enabled,
      speech_bias: Number(cfg.speech_bias) || 0,
      redistribute: cfg.redistribute !== false,
      gains: { ...DEFAULT_NORMALIZATION.gains, ...(cfg.gains ?? {}) },
    };
  } catch (_e) {
    return DEFAULT_NORMALIZATION;
  }
}

const clamp = (n: number) => Math.max(0, Math.min(100, n));

/**
 * Apply speech-skew normalization to a raw score map.
 *
 * 1. Each category is damped by `speech_bias × SPEECH_LOAD[category]`, so
 *    Communication loses the most and Emotional/Contextual barely move.
 * 2. If `redistribute` is on, the total removed points are handed back to the
 *    categories in proportion to their *residual* (non-speech) weight, keeping
 *    the profile's overall level stable while flattening the vocal bias.
 * 3. Per-category gain multipliers are applied last, then values are clamped.
 */
export function normalizeScores(
  raw: Record<Category, number>,
  cfg: NormalizationConfig,
): { scores: Record<Category, number>; audit: NormalizationAudit } {
  const gains = { ...DEFAULT_NORMALIZATION.gains, ...(cfg.gains ?? {}) };
  const out = {} as Record<Category, number>;
  const deltas: Record<string, number> = {};

  if (!cfg.enabled) {
    for (const c of CATEGORIES) {
      out[c] = clamp(Number(raw[c]) || 0);
      deltas[c] = 0;
    }
    return {
      scores: out,
      audit: {
        scope: cfg.scope,
        enabled: false,
        speech_bias: cfg.speech_bias,
        redistribute: cfg.redistribute,
        gains,
        deltas,
        applied_at: new Date().toISOString(),
      },
    };
  }

  const bias = Math.max(0, Math.min(1, Number(cfg.speech_bias) || 0));

  // 1. Damp
  const damped = {} as Record<Category, number>;
  let removed = 0;
  for (const c of CATEGORIES) {
    const v = Number(raw[c]) || 0;
    const cut = v * bias * SPEECH_LOAD[c];
    damped[c] = v - cut;
    removed += cut;
  }

  // 2. Redistribute on residual weight
  if (cfg.redistribute && removed > 0) {
    const weights = {} as Record<Category, number>;
    let total = 0;
    for (const c of CATEGORIES) {
      const w = damped[c] * (1 - SPEECH_LOAD[c]);
      weights[c] = w;
      total += w;
    }
    if (total > 0) {
      for (const c of CATEGORIES) damped[c] += removed * (weights[c] / total);
    }
  }

  // 3. Gains + clamp
  for (const c of CATEGORIES) {
    const v = clamp(damped[c] * (Number(gains[c]) || 1));
    out[c] = Math.round(v * 10) / 10;
    deltas[c] = Math.round((out[c] - (Number(raw[c]) || 0)) * 10) / 10;
  }

  return {
    scores: out,
    audit: {
      scope: cfg.scope,
      enabled: true,
      speech_bias: bias,
      redistribute: cfg.redistribute,
      gains,
      deltas,
      applied_at: new Date().toISOString(),
    },
  };
}

/** Dominant category label for a normalized score map. */
export function dominantCategory(scores: Record<Category, number>): string {
  let best: Category = CATEGORIES[0];
  for (const c of CATEGORIES) if ((scores[c] ?? 0) > (scores[best] ?? 0)) best = c;
  return best.charAt(0).toUpperCase() + best.slice(1);
}

/**
 * Persist normalized scores over the analysis row that analyze-audio just
 * saved for this source, keeping the raw scores for audit/explainability.
 */
export async function applyNormalizationToAnalysis(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  audioSourceId: string,
  raw: Record<Category, number>,
  cfg: NormalizationConfig,
): Promise<Record<Category, number>> {
  const { scores, audit } = normalizeScores(raw, cfg);
  if (!cfg.enabled) return scores;

  try {
    const { data: row, error: selErr } = await supabase
      .from("source_analyses")
      .select("id")
      .eq("audio_source_id", audioSourceId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (selErr) console.warn("normalization row lookup failed", selErr.message);
    if (!row?.id) console.warn("normalization: no analysis row for", audioSourceId);
    if (row?.id) {
      const { error: updErr } = await supabase
        .from("source_analyses")
        .update({
          emotional_score: scores.emotional,
          cognitive_score: scores.cognitive,
          social_score: scores.social,
          communication_score: scores.communication,
          contextual_score: scores.contextual,
          artistic_score: scores.artistic,
          category: dominantCategory(scores),
          raw_scores: raw,
          normalization: audit,
        })
        .eq("id", row.id);
      if (updErr) console.warn("normalization update failed", updErr.message);
      else console.log("normalization applied to analysis", row.id);
    }
  } catch (e) {
    console.warn("normalization persist failed", e);
  }
  return scores;
}
