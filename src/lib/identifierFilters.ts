// Shared identifier-level filtering used by the post-ingestion Semantic
// Analysis page and the Admin Dashboard's identifier-signal views.
//
// Intuizi feeds arrive with thousands of identifiers per activation, so both
// surfaces need the same cheap, deterministic predicate: free-text match on
// display-safe labels plus an AND/OR set of taxonomy tag codes and a basis
// filter (how the ontology vector was derived).

import type { SignalPoint } from "./identifierSignals";

export type BasisFilter = "any" | "scored" | "inherited" | "facet-only";

export interface IdentifierFilterState {
  /** Free text — matched against pseudonym labels, facet labels and tag codes. */
  text: string;
  /** Selected taxonomy tag codes (an identifier matches if it carries any). */
  tags: string[];
  /** Restrict to identifiers whose vector came from a particular basis. */
  basis: BasisFilter;
}

export const EMPTY_IDENTIFIER_FILTER: IdentifierFilterState = {
  text: "",
  tags: [],
  basis: "any",
};

export function isFilterActive(f: IdentifierFilterState): boolean {
  return f.text.trim().length > 0 || f.tags.length > 0 || f.basis !== "any";
}

export function identifierFilterCount(f: IdentifierFilterState): number {
  return (f.text.trim() ? 1 : 0) + f.tags.length + (f.basis !== "any" ? 1 : 0);
}

export interface TagOption {
  code: string;
  /** "app.category.music-audio" -> "music audio" */
  label: string;
  count: number;
}

export function tagLabel(code: string): string {
  const leaf = code.split(".").pop() || code;
  return leaf.replace(/[-_]/g, " ");
}

/** Tag codes present across the given identifiers, most common first. */
export function tagOptions(tagLists: (string[] | null | undefined)[]): TagOption[] {
  const counts = new Map<string, number>();
  for (const list of tagLists) {
    for (const raw of list ?? []) {
      const code = typeof raw === "string" ? raw.trim() : "";
      if (!code) continue;
      counts.set(code, (counts.get(code) || 0) + 1);
    }
  }
  return Array.from(counts.entries())
    .map(([code, count]) => ({ code, label: tagLabel(code), count }))
    .sort((a, b) => b.count - a.count || a.code.localeCompare(b.code));
}

/**
 * Fold a string for search: lower-cased, accent/diacritic-stripped and
 * whitespace-collapsed so "Ámelie  Café" matches "amelie cafe".
 */
export function normalizeSearch(input: string | null | undefined): string {
  if (!input) return "";
  return input
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Accent- and case-insensitive substring match across any haystack.
 * Multiple whitespace-separated terms must all match (AND), which makes
 * incremental typing at scale far more precise.
 */
export function matchesText(haystacks: (string | null | undefined)[], text: string): boolean {
  const q = normalizeSearch(text);
  if (!q) return true;
  const terms = q.split(" ");
  const folded = haystacks.filter(Boolean).map((h) => normalizeSearch(h));
  return terms.every((term) => folded.some((h) => h.includes(term)));
}

export function matchesTags(tags: string[] | null | undefined, selected: string[]): boolean {
  if (!selected.length) return true;
  const own = tags ?? [];
  return selected.some((code) => own.includes(code));
}

/** Filter predicate for a clustered signal point (Admin Dashboard). */
export function signalPointMatches(point: SignalPoint, f: IdentifierFilterState): boolean {
  if (f.basis !== "any" && point.basis !== f.basis) return false;
  if (!matchesTags(point.tags, f.tags)) return false;
  return matchesText([point.label, ...point.facets.map((x) => x.label), ...point.tags], f.text);
}

export function filterSignalPoints(points: SignalPoint[], f: IdentifierFilterState): SignalPoint[] {
  if (!isFilterActive(f)) return points;
  return points.filter((p) => signalPointMatches(p, f));
}
