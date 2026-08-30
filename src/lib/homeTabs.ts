/**
 * The consumer surface collapsed from five tabs to three. Old deep links
 * (?tab=select, ?tab=network, ?tab=sonicsim, ?tab=discover) still resolve, so
 * bookmarks and the mobile nav keep working.
 */
export const TAB_ALIASES: Record<string, string> = {
  select: "listen",
  sonicsim: "listen",
  listen: "listen",
  network: "understand",
  analysis: "understand",
  understand: "understand",
  discover: "library",
  library: "library",
};

export const normalizeTab = (tab: string | null) =>
  (tab && TAB_ALIASES[tab]) || "listen";
