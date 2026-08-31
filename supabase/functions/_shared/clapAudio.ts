// CLAP audio grounding — the missing link between an uploaded/streamable audio
// file and the ontology.
//
// Until now `analyze-audio` only ever *described* audio (librosa numbers,
// provider features, neighbour priors). Nothing ever listened to it in the
// semantic space the taxonomy lives in, so uploads never received AudioSet tags
// and the model was scoring from metadata. This module closes that gap:
//
//   audio url -> CLAP 512-d audio embedding (EC2 semantic service)
//             -> nearest AudioSet taxonomy nodes (match_audioset_nodes)
//             -> audio_source_tags rows + a prompt block for the scorer
//             -> audio_sources.profile_embedding (1536-d, catalog space)
//
// Every call is logged in semantic_call_log. Never throws: grounding is
// enrichment, so a failure degrades to the older evidence tiers.

import {
  clapEmbedAudio,
  getSemanticSvcConfig,
  logSemanticCall,
  projectTo1536,
  type SemanticSvcConfig,
} from "./semanticSvc.ts";
import { enqueueUnknownSymbol } from "./resolverQueue.ts";

export interface ClapTag {
  id: string;
  code: string;
  label: string;
  similarity: number;
}

export interface ClapGrounding {
  tags: ClapTag[];
  /** Prompt block describing what CLAP heard. */
  text: string;
  /** Catalog-space (1536-d) vector for kNN retrieval. */
  vector: number[];
}

/** Human-readable AudioSet leaf label from a `aset.*` code path. */
function tagLabel(t: { label?: string | null; code: string }): string {
  if (t.label && t.label.trim()) return t.label.trim();
  const parts = t.code.split(".");
  return parts[parts.length - 1].replace(/[_-]+/g, " ");
}

/**
 * Listen to one source and write back what was heard.
 *
 * Returns null when the semantic service is unconfigured/unreachable or the URL
 * cannot be embedded — callers then fall through to the next evidence tier.
 */
export async function groundSourceWithClap(
  // deno-lint-ignore no-explicit-any
  admin: any,
  opts: {
    url: string;
    name: string;
    audioSourceId?: string | null;
    topK?: number;
    minSimilarity?: number;
    /** Reuse a config already resolved by the caller. */
    cfg?: SemanticSvcConfig | null;
  },
): Promise<ClapGrounding | null> {
  const url = (opts.url ?? "").trim();
  if (!/^https?:\/\//i.test(url)) return null;

  const cfg = opts.cfg ?? (await getSemanticSvcConfig(admin));
  if (!cfg) return null;

  const topK = Math.max(1, Math.min(12, opts.topK ?? 5));
  const minSim = opts.minSimilarity ?? 0.05;

  const started = Date.now();
  const raw = await clapEmbedAudio(cfg, url, true);
  await logSemanticCall(admin, {
    action: "embed_audio",
    outcome: raw ? "ok" : "error",
    duration_ms: Date.now() - started,
    dims: raw?.length ?? null,
    subject_ref: `${opts.name} :: ${url.slice(0, 160)}`,
    error_message: raw ? null : "embed_audio failed (see function logs)",
  });
  if (!raw) return null;

  const vector = projectTo1536(raw);

  // Nearest AudioSet nodes in CLAP's own 512-d space.
  let tags: ClapTag[] = [];
  try {
    const { data, error } = await admin.rpc("match_audioset_nodes", {
      query_embedding: JSON.stringify(raw),
      match_count: topK,
    });
    if (error) throw new Error(error.message);
    // deno-lint-ignore no-explicit-any
    tags = ((data ?? []) as any[])
      .map((r) => ({
        id: String(r.id),
        code: String(r.code),
        label: tagLabel(r),
        similarity: Number(r.similarity) || 0,
      }))
      .filter((t) => t.similarity >= minSim);
  } catch (e) {
    console.error("match_audioset_nodes failed:", e instanceof Error ? e.message : e);
  }

  // Persist the vector and the tags so the next run (and every aggregate,
  // cohort and kNN query) can use them without paying for CLAP again.
  if (opts.audioSourceId) {
    try {
      await admin
        .from("audio_sources")
        .update({ profile_embedding: JSON.stringify(vector) })
        .eq("id", opts.audioSourceId);
    } catch (e) {
      console.warn("profile_embedding write failed:", e instanceof Error ? e.message : e);
    }

    if (tags.length > 0) {
      try {
        const nodeIds = tags.map((t) => t.id);
        await admin
          .from("audio_source_tags")
          .delete()
          .eq("audio_source_id", opts.audioSourceId)
          .in("node_id", nodeIds);
        await admin.from("audio_source_tags").insert(
          tags.map((t) => ({
            audio_source_id: opts.audioSourceId,
            node_id: t.id,
            weight: Math.round(t.similarity * 1000) / 1000,
          })),
        );
      } catch (e) {
        console.warn("audio_source_tags write failed:", e instanceof Error ? e.message : e);
      }
    }
  }

  // Nothing recognisable in the ontology: hand the symbol to the Resolver so the
  // open-web agent can ground it overnight instead of silently losing the signal.
  if (tags.length === 0) {
    await enqueueUnknownSymbol(admin, {
      symbol: opts.name,
      symbol_type: "other",
      context: {
        reason: "clap_no_taxonomy_match",
        audio_source_id: opts.audioSourceId ?? null,
        url: url.slice(0, 300),
      },
    });
    return { tags, text: "", vector };
  }

  const text =
    `CLAP audio grounding (the audio itself was listened to, CLAP 512-d -> AudioSet): ` +
    tags
      .map((t) => `${tagLabel(t)} (${t.similarity.toFixed(2)})`)
      .join("; ") + ".";

  return { tags, text, vector };
}
