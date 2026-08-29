// IAB Content Taxonomy v1.0 human-readable labels.
//
// Intuizi feeds deliver bare IAB codes ("IAB9-30"). Storing them as
// "IAB category IAB9-30" produced taxonomy nodes with no semantic content, so
// their CLAP text embeddings were meaningless and every AudioSet crosswalk
// proposal collapsed onto the same handful of nodes. Resolving codes to real
// tier-1/tier-2 names restores usable embeddings.
//
// Only tier-2 names we can state with confidence are listed. Anything unknown
// falls back to its tier-1 name, which is semantically safe (a subtopic embeds
// near its parent topic) rather than actively wrong.

export const IAB_TIER1: Record<string, string> = {
  IAB1: "Arts & Entertainment",
  IAB2: "Automotive",
  IAB3: "Business",
  IAB4: "Careers",
  IAB5: "Education",
  IAB6: "Family & Parenting",
  IAB7: "Health & Fitness",
  IAB8: "Food & Drink",
  IAB9: "Hobbies & Interests",
  IAB10: "Home & Garden",
  IAB11: "Law, Government & Politics",
  IAB12: "News",
  IAB13: "Personal Finance",
  IAB14: "Society",
  IAB15: "Science",
  IAB16: "Pets",
  IAB17: "Sports",
  IAB18: "Style & Fashion",
  IAB19: "Technology & Computing",
  IAB20: "Travel",
  IAB21: "Real Estate",
  IAB22: "Shopping",
  IAB23: "Religion & Spirituality",
  IAB24: "Uncategorized",
  IAB25: "Non-Standard Content",
  IAB26: "Illegal Content",
};

export const IAB_TIER2: Record<string, string> = {
  "IAB1-1": "Books & Literature",
  "IAB1-2": "Celebrity Fan & Gossip",
  "IAB1-3": "Fine Art",
  "IAB1-4": "Humor",
  "IAB1-5": "Movies",
  "IAB1-6": "Music",
  "IAB1-7": "Television",
  "IAB2-10": "Electric Vehicle",
  "IAB8-7": "Cuisine-Specific",
  "IAB8-8": "Desserts & Baking",
  "IAB9-2": "Arts & Crafts",
  "IAB9-30": "Video & Computer Games",
  "IAB10-9": "Remodeling & Construction",
  "IAB11-2": "Legal Issues",
  "IAB11-4": "Politics",
  "IAB12-1": "International News",
  "IAB12-2": "National News",
  "IAB12-3": "Local News",
  "IAB15-10": "Weather",
  "IAB19-6": "Cell Phones",
  "IAB19-15": "Email",
};

/** Normalizes a raw feed code to the canonical "IAB9-30" shape. */
export function normalizeIabCode(raw: string): string {
  const compact = String(raw ?? "")
    .toUpperCase()
    .replace(/[^A-Z0-9-]/g, "");
  // Feeds occasionally emit "IAB-7"; the hyphen there is noise, not a tier-2 split.
  return compact.replace(/^IAB-(\d)/, "IAB$1");
}

/**
 * Human-readable label for an IAB code, e.g.
 *   "IAB9-30"  -> "IAB9-30 - Hobbies & Interests: Video & Computer Games"
 *   "IAB7-28"  -> "IAB7-28 - Health & Fitness"        (tier-2 name unknown)
 *   "IAB99"    -> "IAB category IAB99"                (unknown tier-1)
 */
export function iabLabel(raw: string): string {
  const code = normalizeIabCode(raw);
  const tier1Key = code.match(/^IAB\d+/)?.[0] ?? "";
  const tier1 = IAB_TIER1[tier1Key];
  if (!tier1) return `IAB category ${raw}`;

  const tier2 = IAB_TIER2[code];
  // Deeper codes (e.g. IAB12-2-2) resolve to their tier-2 parent when known.
  const tier2Parent = tier2 ? undefined : IAB_TIER2[code.split("-").slice(0, 2).join("-")];
  const leaf = tier2 ?? tier2Parent;

  return leaf ? `${code} - ${tier1}: ${leaf}` : `${code} - ${tier1}`;
}

/**
 * True when a taxonomy label carries no semantic content: the placeholder shape
 * written by the ingest path ("IAB category IAB7"), a bare code ("IAB7"), or the
 * dotted node code itself. Such labels embed meaninglessly, so the crosswalk
 * backfill re-labels them before embedding.
 */
export function isPlaceholderLabel(code: string, label: string | null): boolean {
  const l = (label ?? "").trim();
  if (l.length === 0) return true;
  if (/^IAB category /i.test(l)) return true;
  if (l.toLowerCase() === String(code ?? "").toLowerCase()) return true;
  // "IAB17-2" with nothing after it, or the code's last dotted segment verbatim.
  if (/^IAB[\d-]+$/i.test(l)) return true;
  const leaf = String(code ?? "").split(".").slice(-1)[0];
  return leaf.length > 0 && l.toLowerCase() === leaf.toLowerCase();
}

/** Title-cases a dotted code leaf: `video_games` -> `Video Games`. */
function prettifyLeaf(leaf: string): string {
  return leaf
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Best available human label for a taxonomy node. `iab.*` codes resolve through
 * the IAB tier map; anything else falls back to a prettified code leaf. Returns
 * the existing label untouched when it already reads like real text.
 */
export function enrichNodeLabel(code: string, label: string | null): string {
  if (!isPlaceholderLabel(code, label)) return (label ?? "").trim();
  const c = String(code ?? "");
  if (c.startsWith("iab.")) {
    const resolved = iabLabel(c.slice(4));
    if (!/^IAB category /i.test(resolved)) return resolved;
  }
  const leaf = c.split(".").slice(-1)[0];
  const pretty = prettifyLeaf(leaf);
  return pretty.length > 0 ? pretty : (label ?? c);
}

/**
 * Text handed to CLAP when embedding a non-AudioSet taxonomy node. Mirrors the
 * "the sound of …" phrasing used for `aset.*` nodes so both sides of the
 * crosswalk live in comparable regions of the embedding space.
 */
export function crosswalkText(code: string, label: string | null): string {
  const human = enrichNodeLabel(code, label)
    // "IAB17-2 - Sports" -> "Sports": the code prefix is noise to CLAP.
    .replace(/^IAB[\d-]+\s*-\s*/i, "")
    .replace(/:/g, ",")
    .trim();
  return human.length > 0
    ? `the sound of media about ${human}`
    : "audio content";
}
