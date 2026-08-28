// Mirror of `supabase/functions/_shared/iabLabels.ts` for the client-side
// "Inspect mapping" view. Keep the two in sync.
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
