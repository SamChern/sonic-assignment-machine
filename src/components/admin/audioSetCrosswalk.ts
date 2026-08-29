import type { CrosswalkProposal } from "@/components/admin/IntuiziCatalogTree";
import type { CatalogNode } from "@/lib/intuiziTaxonomy";

/** Shapes and tree-building for the AudioSet crosswalk panel (Step 5). */

/** Vocabularies crosswalked against `aset.*` — mirrors CROSSWALK_PREFIXES. */
export const PREFIXES = [
  { value: "all", label: "All vocabularies" },
  { value: "iab.", label: "IAB content (iab.*)" },
  { value: "ctv.genre.", label: "CTV genres (ctv.genre.*)" },
  { value: "app.", label: "App categories (app.*)" },
  { value: "poi.brand.", label: "POI brands (poi.brand.*)" },
];

export interface PrefixStat {
  total: number;
  proposed: number;
  approved: number;
}

export interface Coverage {
  eligible_total?: number;
  proposed_total?: number;
  approved_total?: number;
  by_prefix?: Record<string, PrefixStat>;
  iab_fully_approved?: boolean;
  aset_nodes?: number;
  aset_embedded?: number;
  aset_pending_embedding?: number;
}

export interface ListedNode {
  id: string;
  code: string;
  label: string | null;
  has_audio_embedding: boolean;
  approved: boolean;
  matches: CrosswalkProposal[];
}

/** Builds a nested tree from dotted taxonomy codes (`iab.arts.music`). */
export function treeFromCodes(nodes: ListedNode[]): CatalogNode[] {
  const byCode = new Map<string, CatalogNode>();
  const ensure = (code: string, label: string | null, meta: Record<string, unknown>) => {
    const existing = byCode.get(code);
    if (existing) {
      if (label) existing.label = label;
      Object.assign(existing.meta, meta);
      return existing;
    }
    const node: CatalogNode = {
      id: code,
      label: label ?? code.split(".").slice(-1)[0],
      parentId: null,
      meta,
      children: [],
    };
    byCode.set(code, node);
    return node;
  };

  for (const n of nodes) {
    ensure(n.code, n.label, {
      embedded: n.has_audio_embedding ? "yes" : "no",
      approved: n.approved ? "yes" : "no",
    });
    const parts = n.code.split(".");
    for (let i = parts.length - 1; i > 1; i--) {
      const childCode = parts.slice(0, i).join(".");
      const parentCode = parts.slice(0, i - 1).join(".");
      const child = ensure(childCode, null, {});
      const parent = ensure(parentCode, null, {});
      if (child.parentId === null) {
        child.parentId = parentCode;
        parent.children.push(child);
      }
    }
  }

  return [...byCode.values()]
    .filter((n) => n.parentId === null)
    .sort((a, b) => a.id.localeCompare(b.id));
}
