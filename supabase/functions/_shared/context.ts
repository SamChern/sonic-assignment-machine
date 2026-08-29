// Step 4 — context-aware scoring helpers for `analyze-audio`.
//
// Three pure concerns live here so they can be unit-tested without a network:
//
//   1. Taxonomy vector preference: a node's CLAP `audio_embedding` is grounded
//      evidence once `grounding_count > 0`; otherwise fall back to the 1536-d
//      text `embedding`.
//   2. CaMML-style exemplars: turn `match_audio_profiles` kNN rows into explicit
//      few-shot exemplars `{similarity, six_scores, top_tags}` instead of a
//      single averaged prior.
//   3. Tag-only subject vector: weight-normalized sum of tag embeddings, used
//      when a subject has taxonomy context but no audio file at all.

export const CATEGORIES = [
  "emotional",
  "cognitive",
  "social",
  "communication",
  "contextual",
  "artistic",
] as const;
export type Category = typeof CATEGORIES[number];

const round2 = (n: number) => Math.round(n * 100) / 100;

/* -------------------------------------------------------------------------- */
/* 1. taxonomy vector preference                                              */
/* -------------------------------------------------------------------------- */

export interface TaxonomyNodeVectors {
  id?: string;
  code?: string;
  label?: string;
  embedding?: number[] | string | null;
  audio_embedding?: number[] | string | null;
  grounding_count?: number | null;
  weight?: number | null;
}

export type VectorSpace = "audio" | "text";

export interface PickedVector {
  vector: number[];
  space: VectorSpace;
}

/** pgvector values arrive either as arrays or as the `[1,2,3]` text form. */
export function toVector(value: unknown): number[] | null {
  if (Array.isArray(value)) {
    const nums = value.map((v) => Number(v));
    return nums.every((n) => Number.isFinite(n)) && nums.length > 0 ? nums : null;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed.startsWith("[") || !trimmed.endsWith("]")) return null;
    const parts = trimmed.slice(1, -1).split(",").map((p) => Number(p.trim()));
    return parts.length > 0 && parts.every((n) => Number.isFinite(n)) ? parts : null;
  }
  return null;
}

/**
 * Prefer the grounded audio embedding, else the text embedding.
 * Returns null when the node has neither.
 */
export function pickNodeVector(node: TaxonomyNodeVectors): PickedVector | null {
  const grounded = Number(node.grounding_count ?? 0) > 0;
  if (grounded) {
    const audio = toVector(node.audio_embedding);
    if (audio) return { vector: audio, space: "audio" };
  }
  const text = toVector(node.embedding);
  if (text) return { vector: text, space: "text" };
  // A node can carry an audio vector without any grounding counter yet; it is
  // still better than nothing, but only as a last resort.
  const audio = toVector(node.audio_embedding);
  return audio ? { vector: audio, space: "audio" } : null;
}

/* -------------------------------------------------------------------------- */
/* 2. CaMML-style neighbour exemplars                                        */
/* -------------------------------------------------------------------------- */

// deno-lint-ignore no-explicit-any
export type NeighborRow = Record<string, any>;

export interface NeighborExemplar {
  id: string | null;
  name: string | null;
  similarity: number;
  six_scores: Record<Category, number>;
  top_tags: string[];
}

export interface ExemplarContext {
  exemplars: NeighborExemplar[];
  ids: string[];
  /** Prompt-ready block handed to the scoring step. */
  text: string;
}

/**
 * Restructure kNN rows into per-neighbour exemplars. Rows missing every score
 * are dropped; ordering follows similarity, descending.
 */
export function buildNeighborExemplars(
  rows: NeighborRow[] | null | undefined,
  tagsById: Map<string, string[]> = new Map(),
  limit = 5,
): ExemplarContext {
  const exemplars: NeighborExemplar[] = [];
  for (const row of rows ?? []) {
    const scores = {} as Record<Category, number>;
    let present = 0;
    for (const cat of CATEGORIES) {
      const v = Number(row[`${cat}_score`]);
      if (Number.isFinite(v)) {
        scores[cat] = Math.round(v);
        present++;
      } else {
        scores[cat] = 50;
      }
    }
    if (present === 0) continue;
    const id = typeof row.id === "string" ? row.id : null;
    const sim = Number(row.similarity);
    exemplars.push({
      id,
      name: typeof row.name === "string" ? row.name : null,
      similarity: Number.isFinite(sim) ? round2(sim) : 0,
      six_scores: scores,
      top_tags: (id ? tagsById.get(id) : undefined) ?? [],
    });
  }

  exemplars.sort((a, b) => b.similarity - a.similarity);
  const kept = exemplars.slice(0, limit);

  const text = kept.length === 0 ? "" : [
    `exemplars=${kept.length}`,
    ...kept.map((ex, i) => {
      const scores = CATEGORIES.map((c) => `${c}=${ex.six_scores[c]}`).join(" ");
      const tags = ex.top_tags.length ? ` tags=[${ex.top_tags.join(",")}]` : "";
      return `exemplar${i + 1}(similarity=${ex.similarity} ${scores}${tags})`;
    }),
  ].join(" ");

  return {
    exemplars: kept,
    ids: kept.map((e) => e.id).filter((v): v is string => !!v),
    text,
  };
}

/* -------------------------------------------------------------------------- */
/* 3. tag-only subject vector                                                */
/* -------------------------------------------------------------------------- */

export interface WeightedVector {
  vector: number[];
  space: VectorSpace;
  /** Number of tags that actually contributed. */
  used: number;
  /** Tags dropped because they live in the other space or a mismatched width. */
  dropped: number;
  weight_sum: number;
}

/**
 * Weight-normalized sum of tag embeddings, L2-normalized so cosine geometry is
 * preserved. Mixed spaces are not blended: whichever space carries the most
 * weight wins, and the other tags are ignored (their dimensionality differs).
 */
export function weightedTagVector(
  nodes: TaxonomyNodeVectors[],
): WeightedVector | null {
  const picked: Array<{ v: number[]; w: number; space: VectorSpace }> = [];
  for (const node of nodes ?? []) {
    const p = pickNodeVector(node);
    if (!p) continue;
    const w = Number(node.weight);
    picked.push({ v: p.vector, w: Number.isFinite(w) && w > 0 ? w : 1, space: p.space });
  }
  if (picked.length === 0) return null;

  const weightBySpace = new Map<VectorSpace, number>();
  for (const p of picked) {
    weightBySpace.set(p.space, (weightBySpace.get(p.space) ?? 0) + p.w);
  }
  const space = [...weightBySpace.entries()].sort((a, b) => b[1] - a[1])[0][0];
  const chosen = picked.filter((p) => p.space === space);

  const dims = chosen[0].v.length;
  const usable = chosen.filter((p) => p.v.length === dims);
  const weightSum = usable.reduce((s, p) => s + p.w, 0);
  if (weightSum <= 0) return null;

  const acc = new Array(dims).fill(0);
  for (const p of usable) {
    const w = p.w / weightSum;
    for (let i = 0; i < dims; i++) acc[i] += p.v[i] * w;
  }

  const norm = Math.sqrt(acc.reduce((s, v) => s + v * v, 0));
  const vector = norm > 0 ? acc.map((v) => v / norm) : acc;

  return {
    vector,
    space,
    used: usable.length,
    dropped: Math.max(0, picked.length - usable.length),
    weight_sum: round2(weightSum),
  };
}

/** Compact human/LLM-readable summary of the tag-only subject. */
export function describeTagSubject(
  nodes: TaxonomyNodeVectors[],
  vec: WeightedVector | null,
): string {
  const tags = (nodes ?? [])
    .map((n) => {
      const w = Number(n.weight);
      const code = n.code ?? n.label ?? n.id ?? "?";
      return Number.isFinite(w) ? `${code}:${round2(w)}` : `${code}`;
    })
    .slice(0, 12);
  const head = `subject=tags_only tag_count=${(nodes ?? []).length}`;
  const body = tags.length ? ` tag_weights=[${tags.join(",")}]` : "";
  const vecPart = vec
    ? ` subject_vector=${vec.space}:${vec.vector.length}d from=${vec.used}tags` +
      (vec.dropped > 0 ? ` tags_other_space=${vec.dropped}` : "")
    : " subject_vector=none";
  return `${head}${body}${vecPart}`;
}

/* -------------------------------------------------------------------------- */
/* 4. bridging a grounded (512-d) subject into the catalog space (1536-d)      */
/* -------------------------------------------------------------------------- */

/** Width of the catalog vectors used by `match_audio_profiles`. */
export const CATALOG_DIMS = 1536;

export type BridgeRoute = "native" | "bridge" | "pad";

/**
 * Which route takes a subject vector into the catalog space:
 *   native — already the catalog width, nothing to do;
 *   bridge — a trained bridge is available for this width pair;
 *   pad    — deterministic tiling fallback so kNN still returns neighbours.
 */
export function pickBridgeRoute(
  dims: number,
  bridge: { from_dim?: number | null; to_dim?: number | null } | null | undefined,
  target = CATALOG_DIMS,
): BridgeRoute {
  if (dims === target) return "native";
  if (
    bridge &&
    Number(bridge.from_dim) === dims &&
    Number(bridge.to_dim) === target
  ) return "bridge";
  return "pad";
}

/**
 * Deterministic width fallback: tile the source vector across the target width
 * and L2-normalize. Byte-for-byte the same convention the semantic service uses
 * for its identity bridge, so padded and service-bridged vectors are comparable.
 */
export function padToCatalog(v: number[], target = CATALOG_DIMS): number[] {
  if (!Array.isArray(v) || v.length === 0) return [];
  const out = new Array<number>(target);
  for (let i = 0; i < target; i++) out[i] = v[i % v.length];
  const n = Math.sqrt(out.reduce((s, x) => s + x * x, 0));
  return n > 0 ? out.map((x) => x / n) : out;
}

/** Audit fragment appended to the prompt context so routing stays visible. */
export function describeBridge(route: BridgeRoute, fromDims: number, bridgeName?: string | null): string {
  if (route === "native") return `vector_route=native dims=${fromDims}`;
  if (route === "bridge") {
    return `vector_route=bridge from=${fromDims}d to=${CATALOG_DIMS}d${bridgeName ? ` bridge=${bridgeName}` : ""}`;
  }
  return `vector_route=pad from=${fromDims}d to=${CATALOG_DIMS}d`;
}
