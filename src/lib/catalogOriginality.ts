/**
 * Catalog originality rollup.
 *
 * A track's originality is the Originality Score of the analysis behind its
 * linked audio source. A symbol's originality is the mean of the tracks carrying
 * it. An album or label has no waveform of its own, so its originality is the
 * weighted average of the symbols underneath it — each symbol weighted by how
 * many scored tracks back it. That keeps a label from being flattered by one
 * distinctive single, and keeps a well-evidenced symbol pulling more weight than
 * one seen on a single track.
 */

export interface CatalogNode {
  id: string;
  kind: "label" | "album" | "track";
  parent_id: string | null;
  audio_source_id: string | null;
  symbols: string[] | null;
}

export interface AnalysisScore {
  originality_score: number | null | undefined;
}

export interface Rollup {
  /** 0-100, or null when nothing underneath is scored yet. */
  score: number | null;
  /** How the number was reached, for the UI to be honest about it. */
  basis: "measured" | "symbols" | "none";
  /** Scored tracks contributing to it. */
  tracks: number;
  /** Symbols contributing to it (albums / labels only). */
  symbols: number;
}

export interface SymbolStat {
  symbol: string;
  score: number;
  tracks: number;
}

const clamp = (n: number) => Math.max(0, Math.min(100, n));

const mean = (values: number[]) =>
  values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;

/**
 * Roll originality up a catalog tree.
 *
 * @param items every catalog row for this owner
 * @param scoreBySourceId originality per linked audio source (0-100)
 */
export function rollupCatalogOriginality(
  items: CatalogNode[],
  scoreBySourceId: Map<string, number>,
): { byItem: Map<string, Rollup>; bySymbol: Map<string, SymbolStat> } {
  const byId = new Map(items.map((i) => [i.id, i]));
  const children = new Map<string, CatalogNode[]>();
  for (const item of items) {
    if (!item.parent_id) continue;
    if (!byId.has(item.parent_id)) continue;
    const list = children.get(item.parent_id) ?? [];
    list.push(item);
    children.set(item.parent_id, list);
  }

  // 1. Track scores straight off the linked analysis.
  const trackScore = new Map<string, number>();
  for (const item of items) {
    if (item.kind !== "track" || !item.audio_source_id) continue;
    const raw = scoreBySourceId.get(item.audio_source_id);
    if (raw === undefined || !Number.isFinite(raw)) continue;
    trackScore.set(item.id, clamp(Number(raw)));
  }

  // 2. Symbol stats: mean of the scored tracks carrying each symbol.
  const perSymbol = new Map<string, number[]>();
  for (const item of items) {
    if (item.kind !== "track") continue;
    const score = trackScore.get(item.id);
    if (score === undefined) continue;
    for (const symbol of item.symbols ?? []) {
      const key = symbol.trim();
      if (!key) continue;
      const list = perSymbol.get(key) ?? [];
      list.push(score);
      perSymbol.set(key, list);
    }
  }
  const bySymbol = new Map<string, SymbolStat>();
  for (const [symbol, scores] of perSymbol) {
    const avg = mean(scores);
    if (avg === null) continue;
    bySymbol.set(symbol, { symbol, score: Math.round(avg), tracks: scores.length });
  }

  // 3. Collect the descendant tracks of every node, then weight by symbol.
  const descendantTracks = (id: string, seen = new Set<string>()): CatalogNode[] => {
    if (seen.has(id)) return [];
    seen.add(id);
    const node = byId.get(id);
    if (!node) return [];
    if (node.kind === "track") return [node];
    return (children.get(id) ?? []).flatMap((child) => descendantTracks(child.id, seen));
  };

  const byItem = new Map<string, Rollup>();
  for (const item of items) {
    if (item.kind === "track") {
      const score = trackScore.get(item.id);
      byItem.set(item.id, {
        score: score === undefined ? null : Math.round(score),
        basis: score === undefined ? "none" : "measured",
        tracks: score === undefined ? 0 : 1,
        symbols: (item.symbols ?? []).length,
      });
      continue;
    }

    // An album / label inherits the symbols of its own row plus its tracks'.
    const tracks = descendantTracks(item.id);
    const scored = tracks.filter((t) => trackScore.has(t.id));
    const symbolKeys = new Set<string>();
    for (const symbol of item.symbols ?? []) if (symbol.trim()) symbolKeys.add(symbol.trim());
    for (const track of scored) {
      for (const symbol of track.symbols ?? []) if (symbol.trim()) symbolKeys.add(symbol.trim());
    }

    let weightSum = 0;
    let weighted = 0;
    let usedSymbols = 0;
    for (const key of symbolKeys) {
      const stat = bySymbol.get(key);
      if (!stat) continue;
      weighted += stat.score * stat.tracks;
      weightSum += stat.tracks;
      usedSymbols += 1;
    }

    if (weightSum > 0) {
      byItem.set(item.id, {
        score: Math.round(clamp(weighted / weightSum)),
        basis: "symbols",
        tracks: scored.length,
        symbols: usedSymbols,
      });
      continue;
    }

    // No symbols to weight by: fall back to the plain mean of its tracks.
    const plain = mean(scored.map((t) => trackScore.get(t.id)!));
    byItem.set(item.id, {
      score: plain === null ? null : Math.round(clamp(plain)),
      basis: plain === null ? "none" : "measured",
      tracks: scored.length,
      symbols: 0,
    });
  }

  return { byItem, bySymbol };
}

export const formatCents = (cents: number | null | undefined, currency = "USD") => {
  if (cents === null || cents === undefined || !Number.isFinite(Number(cents))) return null;
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(
      Number(cents) / 100,
    );
  } catch {
    return `$${(Number(cents) / 100).toFixed(2)}`;
  }
};
