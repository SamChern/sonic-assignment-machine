// Shared ontology helpers: embeddings, taxonomy node resolution, calibration
// priors and Welford updates. Used by ctv-ingest and intuizi-ingest so both
// feeds earn the same six-category treatment.

export const CATEGORIES = [
  "emotional",
  "cognitive",
  "social",
  "communication",
  "contextual",
  "artistic",
] as const;
export type Category = typeof CATEGORIES[number];

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { embedCached } from "./inference.ts";
import { isSensitiveTag } from "./sensitiveTaxonomy.ts";

// Dedicated service-role client used only for the embedding cache, so callers
// that do not already hold a client still get cache hits.
const embedCacheClient = (() => {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  return url && key ? createClient(url, key) : null;
})();

export interface OntologyTag {
  code: string;
  label?: string;
  parent_code?: string;
  weight?: number;
}

/**
 * Embed a text string. Routed through the inference layer (EC2 inference server
 * first, Lovable AI Gateway as fallback) and served from `embedding_cache` when
 * the same text has been embedded before. Returns null on non-terminal failure.
 */
export async function embed(text: string): Promise<number[] | null> {
  return await embedCached(embedCacheClient, text);
}

/**
 * Find or create a taxonomy node for a tag code; returns its id, or null when
 * the node is suppressed (sensitive POI class — health, worship, shelters …).
 * Suppressed nodes are never tagged onto an audio source.
 */
export async function resolveTag(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  tag: OntologyTag,
): Promise<string | null> {
  const { data: existing } = await supabase
    .from("taxonomy_nodes").select("id, suppressed").eq("code", tag.code).maybeSingle();
  if (existing) return existing.suppressed ? null : (existing.id as string);

  const label = tag.label ?? tag.code;
  // New nodes get their suppression flag at creation time so a sensitive class
  // is never taggable, not even on the run that first discovers it.
  const suppressed = isSensitiveTag(tag.code, label);
  const embedding = suppressed
    ? null
    : await embed(
      `${tag.code} :: ${label}${tag.parent_code ? ` (under ${tag.parent_code})` : ""}`,
    );
  const { data: inserted, error } = await supabase
    .from("taxonomy_nodes")
    .insert({ code: tag.code, label, parent_code: tag.parent_code ?? null, embedding, suppressed })
    .select("id").single();
  if (error) {
    // Concurrent insert — re-read.
    const { data: retry } = await supabase
      .from("taxonomy_nodes").select("id, suppressed").eq("code", tag.code).maybeSingle();
    if (retry) return retry.suppressed ? null : (retry.id as string);
    throw error;
  }
  return suppressed ? null : (inserted.id as string);
}


/** Build the calibration prior block that gets handed to analyze-audio. */
export async function buildTaxonomyContext(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  nodeIds: string[],
): Promise<string> {
  if (!nodeIds.length) return "";
  const { data: nodes } = await supabase
    .from("taxonomy_nodes").select("code,label").in("id", nodeIds);
  const { data: calib } = await supabase
    .from("category_calibration")
    .select("category,mean_score,m2,n,bias")
    .in("taxonomy_node_id", nodeIds);

  // deno-lint-ignore no-explicit-any
  const tagLine = (nodes ?? []).map((n: any) => `${n.code}(${n.label})`).join(", ");
  if (!calib || calib.length === 0) return `tags=[${tagLine}] (no prior; cold start)`;

  const byCat: Record<string, { sum: number; n: number; varSum: number }> = {};
  for (const c of calib) {
    const k = c.category as string;
    const std = c.n > 1 ? Math.sqrt(Number(c.m2) / (c.n - 1)) : 0;
    byCat[k] ??= { sum: 0, n: 0, varSum: 0 };
    byCat[k].sum += Number(c.mean_score) * c.n;
    byCat[k].n += c.n;
    byCat[k].varSum += std * std;
  }
  const priorParts = CATEGORIES.map((cat) => {
    const a = byCat[cat];
    if (!a || a.n === 0) return `${cat}=?`;
    const mean = a.sum / a.n;
    const std = Math.sqrt(a.varSum / Math.max(1, Object.keys(byCat).length));
    return `${cat}=${mean.toFixed(0)}±${std.toFixed(0)}`;
  }).join(" ");
  return `tags=[${tagLine}] prior(${priorParts})`;
}

/** Welford update of per-node, per-category calibration stats. */
export async function updateCalibration(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  nodeIds: string[],
  scores: Record<Category, number>,
): Promise<void> {
  for (const nodeId of nodeIds) {
    for (const cat of CATEGORIES) {
      const x = Number(scores[cat]) || 0;
      const { data: row } = await supabase
        .from("category_calibration")
        .select("id,n,mean_score,m2,bias")
        .eq("taxonomy_node_id", nodeId).eq("category", cat).maybeSingle();
      if (!row) {
        await supabase.from("category_calibration").insert({
          taxonomy_node_id: nodeId, category: cat, n: 1, mean_score: x, m2: 0, bias: 0,
        });
      } else {
        const n = row.n + 1;
        const delta = x - Number(row.mean_score);
        const mean = Number(row.mean_score) + delta / n;
        const m2 = Number(row.m2) + delta * (x - mean);
        await supabase.from("category_calibration")
          .update({ n, mean_score: mean, m2, updated_at: new Date().toISOString() })
          .eq("id", row.id);
      }
    }
  }
}
