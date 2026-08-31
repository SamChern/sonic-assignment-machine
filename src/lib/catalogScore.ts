/**
 * Catalog score — how strong a label's catalog is, in one number.
 *
 * Three legs, deliberately different in character:
 *  - Originality: the label's rollup originality (see catalogOriginality.ts).
 *  - Grounding confidence: how well-evidenced the label's tracks are — the mean
 *    analysis confidence of its linked audio, lifted by grounded evidence and
 *    held back when tracks resolve without grounding.
 *  - Completeness: how much of the catalog is actually filled in — albums under
 *    the label, tracks under the albums, linked audio, symbols, release years.
 *
 * A label that scores high on all three is one we can quote, price and sell.
 */

import { rollupCatalogOriginality, type CatalogNode } from "./catalogOriginality";

export interface CatalogScoreItem extends CatalogNode {
  title: string;
  artist?: string | null;
  label_name?: string | null;
  release_year?: number | null;
  for_sale?: boolean | null;
}

export interface CatalogAnalysisFacts {
  originality_score: number | null;
  /** 0-1 analysis confidence. */
  confidence: number | null;
  /** e.g. "grounded" | "partial" | "ungrounded". */
  grounding_level: string | null;
}

export interface LabelScore {
  id: string;
  title: string;
  score: number;
  originality: number | null;
  grounding: number | null;
  completeness: number;
  albums: number;
  tracks: number;
  scoredTracks: number;
  groundedTracks: number;
  listedTracks: number;
  symbols: number;
  /** Plain-language nudge: the weakest leg to work on next. */
  gap: string;
}

const clamp = (n: number) => Math.max(0, Math.min(100, n));
const pct = (part: number, whole: number) => (whole <= 0 ? 0 : (part / whole) * 100);

const GROUNDING_WEIGHT: Record<string, number> = {
  grounded: 1,
  strong: 1,
  partial: 0.6,
  weak: 0.35,
  ungrounded: 0.1,
  none: 0.1,
};

const groundingWeight = (level: string | null | undefined) =>
  GROUNDING_WEIGHT[(level ?? "").toLowerCase()] ?? 0.5;

export const WEIGHTS = { originality: 0.45, grounding: 0.35, completeness: 0.2 };

/**
 * Rank every label in a catalog.
 *
 * @param items all catalog rows in scope (labels, albums, tracks)
 * @param analysisBySourceId analysis facts keyed by audio source id
 */
export function rankLabelCatalogs(
  items: CatalogScoreItem[],
  analysisBySourceId: Map<string, CatalogAnalysisFacts>,
): LabelScore[] {
  const originalityBySource = new Map<string, number>();
  for (const [sourceId, facts] of analysisBySourceId) {
    if (facts.originality_score === null || facts.originality_score === undefined) continue;
    originalityBySource.set(sourceId, Number(facts.originality_score));
  }
  const { byItem } = rollupCatalogOriginality(items, originalityBySource);

  const byId = new Map(items.map((i) => [i.id, i]));
  const childrenOf = new Map<string, CatalogScoreItem[]>();
  for (const item of items) {
    if (!item.parent_id || !byId.has(item.parent_id)) continue;
    const list = childrenOf.get(item.parent_id) ?? [];
    list.push(item);
    childrenOf.set(item.parent_id, list);
  }

  const labels = items.filter((i) => i.kind === "label");

  return labels
    .map<LabelScore>((label) => {
      const albums = (childrenOf.get(label.id) ?? []).filter((c) => c.kind === "album");
      const directTracks = (childrenOf.get(label.id) ?? []).filter((c) => c.kind === "track");
      const tracks = [
        ...directTracks,
        ...albums.flatMap((a) => (childrenOf.get(a.id) ?? []).filter((c) => c.kind === "track")),
      ];

      const linked = tracks.filter((t) => t.audio_source_id);
      const facts = linked
        .map((t) => analysisBySourceId.get(t.audio_source_id as string))
        .filter(Boolean) as CatalogAnalysisFacts[];

      // Grounding confidence: analysis confidence discounted by grounding level.
      const grounding = facts.length
        ? clamp(
            (facts.reduce((sum, f) => {
              const conf = Number(f.confidence ?? 0);
              const normalized = conf > 1 ? conf / 100 : conf;
              return sum + normalized * groundingWeight(f.grounding_level);
            }, 0) /
              facts.length) *
              100,
          )
        : null;

      const groundedTracks = facts.filter((f) => groundingWeight(f.grounding_level) >= 0.6).length;
      const scoredTracks = linked.filter((t) =>
        originalityBySource.has(t.audio_source_id as string),
      ).length;
      const listedTracks = tracks.filter((t) => t.for_sale).length;

      const symbols = new Set<string>();
      for (const node of [label, ...albums, ...tracks]) {
        for (const sym of node.symbols ?? []) if (sym.trim()) symbols.add(sym.trim());
      }

      // Completeness: structure filled in, audio linked, symbols and years present.
      const completeness = clamp(
        0.2 * (albums.length > 0 ? 100 : 0) +
          0.2 * Math.min(100, tracks.length * 20) +
          0.25 * pct(linked.length, Math.max(1, tracks.length)) +
          0.2 * pct(tracks.filter((t) => (t.symbols ?? []).length > 0).length, Math.max(1, tracks.length)) +
          0.15 * pct(tracks.filter((t) => t.release_year).length, Math.max(1, tracks.length)),
      );

      const originality = byItem.get(label.id)?.score ?? null;

      const score = Math.round(
        clamp(
          WEIGHTS.originality * (originality ?? 0) +
            WEIGHTS.grounding * (grounding ?? 0) +
            WEIGHTS.completeness * completeness,
        ),
      );

      const legs: [string, number][] = [
        ["originality — no scored tracks yet", originality ?? 0],
        ["grounding — run an audio signal refresh", grounding ?? 0],
        ["completeness — link audio and symbols to tracks", completeness],
      ];
      legs.sort((a, b) => a[1] - b[1]);

      return {
        id: label.id,
        title: label.title,
        score,
        originality,
        grounding,
        completeness: Math.round(completeness),
        albums: albums.length,
        tracks: tracks.length,
        scoredTracks,
        groundedTracks,
        listedTracks,
        symbols: symbols.size,
        gap: legs[0][0],
      };
    })
    .sort((a, b) => b.score - a.score || a.title.localeCompare(b.title));
}
