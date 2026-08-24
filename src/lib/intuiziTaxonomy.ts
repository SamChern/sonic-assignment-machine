/**
 * Turns Intuizi `lookup_reference` payloads into a nested category tree.
 *
 * Intuizi's reference catalogs are flat lists whose hierarchy is implied rather
 * than declared: the Apps Report carries CategoryID/CategoryName above
 * TaxonomyID/TaxonomyName, CTV rows carry a device Taxonomy/ID pair, and both
 * the Web and CTV reports carry pipe-delimited IAB Content Taxonomy codes where
 * `IAB13-3` sits under `IAB13`. This module normalizes whatever shape a catalog
 * returns and derives the nesting from those documented conventions so the
 * admin catalog browser can render real parent → child groups.
 *
 * Sources: Apps Report, Connected TV (CTV), Web Report and Visitation Details
 * Intuizi docs.
 */

export interface CatalogDataset {
  /** `dataset` argument passed to lookup_reference. */
  dataset: string;
  label: string;
  /** Known catalogs for this dataset, in the order an admin usually wants them. */
  catalogs: { catalog: string; label: string; hint?: string }[];
}

/**
 * Documented dataset/catalog pairs. Discovery from the server is attempted
 * first; these keep the picker useful when a catalog list is unavailable.
 */
export const CATALOG_DATASETS: CatalogDataset[] = [
  {
    dataset: "common",
    label: "Common",
    catalogs: [
      { catalog: "dataset-types", label: "Dataset types", hint: "which datasets your account can query" },
      { catalog: "signal-providers", label: "Signal providers" },
      { catalog: "countries", label: "Countries", hint: "ISO 3166-1" },
      { catalog: "iab-categories", label: "IAB content taxonomy", hint: "nests IAB13-3 under IAB13" },
    ],
  },
  {
    dataset: "ctv",
    label: "Connected TV",
    catalogs: [
      { catalog: "taxonomies", label: "CTV device taxonomies", hint: "Samsung Television = 1, Roku = 2, …" },
      { catalog: "genres", label: "Content genres", hint: "contentgenre values" },
      { catalog: "content-types", label: "Content types" },
      { catalog: "channels", label: "Channels" },
    ],
  },
  {
    dataset: "apps",
    label: "Apps",
    catalogs: [
      { catalog: "categories", label: "App categories", hint: "CategoryID / CategoryName" },
      { catalog: "taxonomies", label: "App taxonomies", hint: "TaxonomyID nested under its category" },
    ],
  },
  {
    dataset: "web",
    label: "Web",
    catalogs: [
      { catalog: "iab-categories", label: "IAB content taxonomy" },
      { catalog: "domains", label: "Top domains" },
    ],
  },
  {
    dataset: "visitation",
    label: "Visitation",
    catalogs: [
      { catalog: "brands", label: "Brands", hint: "brandID / brandName" },
      { catalog: "categories", label: "POI categories" },
    ],
  },
];

export interface CatalogNode {
  id: string;
  label: string;
  parentId: string | null;
  /** Remaining row fields, shown in the detail line. */
  meta: Record<string, unknown>;
  children: CatalogNode[];
}

const ID_KEYS = [
  "taxonomy_id",
  "taxonomyid",
  "category_id",
  "categoryid",
  "brand_id",
  "brandid",
  "code",
  "id",
  "value",
  "key",
];

const LABEL_KEYS = [
  "taxonomy_name",
  "taxonomyname",
  "category_name",
  "categoryname",
  "brand_name",
  "brandname",
  "taxonomy",
  "name",
  "label",
  "title",
  "description",
];

const PARENT_KEYS = [
  "parent_id",
  "parentid",
  "parent_code",
  "parent",
  "category_id",
  "categoryid",
  "category",
  "group",
  "dataset",
];

const pick = (row: Record<string, unknown>, keys: string[], skip?: string) => {
  const lower = new Map(Object.keys(row).map((k) => [k.toLowerCase(), k]));
  for (const k of keys) {
    const actual = lower.get(k);
    if (!actual || actual === skip) continue;
    const v = row[actual];
    if (v === null || v === undefined) continue;
    const s = String(v).trim();
    if (s) return { key: actual, value: s };
  }
  return null;
};

/** IAB codes nest by their dash suffix: IAB13-3 → parent IAB13. */
const iabParent = (id: string) => {
  const m = /^(IAB\d+)-\d+$/i.exec(id.trim());
  return m ? m[1].toUpperCase() : null;
};

/** Labels may carry their own path, e.g. "Sports > Soccer" or "News|Politics". */
const splitPath = (label: string) =>
  label
    .split(/\s*(?:>|\||\/|::)\s*/)
    .map((s) => s.trim())
    .filter(Boolean);

/**
 * Normalize arbitrary catalog rows into flat nodes with a resolved parent.
 * Rows that are plain strings or numbers become leaf nodes.
 */
export function normalizeCatalogRows(input: unknown[]): CatalogNode[] {
  const out: CatalogNode[] = [];
  const pathIds = new Map<string, string>();

  input.forEach((raw, index) => {
    if (raw === null || raw === undefined) return;

    if (typeof raw !== "object") {
      const label = String(raw).trim();
      if (!label) return;
      const parts = splitPath(label);
      let parentId: string | null = null;
      // Materialize implicit ancestors so "Sports > Soccer" nests correctly.
      parts.slice(0, -1).forEach((part, depth) => {
        const key = parts.slice(0, depth + 1).join(" > ");
        let id = pathIds.get(key);
        if (!id) {
          id = `path:${key}`;
          pathIds.set(key, id);
          out.push({ id, label: part, parentId, meta: {}, children: [] });
        }
        parentId = id;
      });
      out.push({
        id: `${parentId ?? "root"}:${parts[parts.length - 1] ?? index}`,
        label: parts[parts.length - 1] ?? label,
        parentId,
        meta: {},
        children: [],
      });
      return;
    }

    const row = raw as Record<string, unknown>;
    const idHit = pick(row, ID_KEYS);
    const labelHit = pick(row, LABEL_KEYS);
    const id = idHit?.value ?? labelHit?.value ?? String(index);
    const label = labelHit?.value ?? id;
    const parentHit = pick(row, PARENT_KEYS, idHit?.key);
    let parentId = parentHit && parentHit.value !== id ? parentHit.value : null;
    if (!parentId) parentId = iabParent(id);

    const meta: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(row)) {
      if (k === idHit?.key || k === labelHit?.key || k === parentHit?.key) continue;
      if (v === null || v === undefined || v === "") continue;
      meta[k] = v;
    }

    out.push({ id, label, parentId, meta, children: [] });
  });

  return out;
}

export interface CatalogTree {
  roots: CatalogNode[];
  total: number;
  /** Parent ids referenced but never returned as their own row. */
  synthesizedParents: number;
}

/** Nest flat nodes into a tree, synthesizing parents referenced but not listed. */
export function buildCatalogTree(flat: CatalogNode[]): CatalogTree {
  const byId = new Map<string, CatalogNode>();
  for (const n of flat) {
    if (!byId.has(n.id)) byId.set(n.id, { ...n, children: [] });
  }

  let synthesized = 0;
  for (const n of Array.from(byId.values())) {
    if (n.parentId && !byId.has(n.parentId)) {
      byId.set(n.parentId, {
        id: n.parentId,
        label: n.parentId,
        parentId: null,
        meta: { synthesized: true },
        children: [],
      });
      synthesized += 1;
    }
  }

  const roots: CatalogNode[] = [];
  for (const n of byId.values()) {
    if (n.parentId && byId.has(n.parentId) && n.parentId !== n.id) {
      byId.get(n.parentId)!.children.push(n);
    } else {
      roots.push(n);
    }
  }

  const sortRec = (nodes: CatalogNode[]) => {
    nodes.sort((a, b) => {
      const na = Number(a.id);
      const nb = Number(b.id);
      if (Number.isFinite(na) && Number.isFinite(nb)) return na - nb;
      return a.label.localeCompare(b.label);
    });
    nodes.forEach((n) => sortRec(n.children));
  };
  sortRec(roots);

  return { roots, total: byId.size, synthesizedParents: synthesized };
}

/** Keep nodes whose label/id matches, preserving their ancestor chain. */
export function filterCatalogTree(roots: CatalogNode[], query: string): CatalogNode[] {
  const q = query.trim().toLowerCase();
  if (!q) return roots;
  const walk = (nodes: CatalogNode[]): CatalogNode[] =>
    nodes
      .map((n) => {
        const kids = walk(n.children);
        const self = n.label.toLowerCase().includes(q) || n.id.toLowerCase().includes(q);
        return self || kids.length ? { ...n, children: kids } : null;
      })
      .filter((n): n is CatalogNode => n !== null);
  return walk(roots);
}

/** Depth-first count of every node in a subtree, including the node itself. */
export function countNodes(nodes: CatalogNode[]): number {
  return nodes.reduce((sum, n) => sum + 1 + countNodes(n.children), 0);
}

/**
 * Pull the row array out of an Intuizi envelope shape, tolerating
 * `{ data: [...] }`, `{ data: { items: [...] } }` and bare arrays.
 */
export function extractCatalogArray(payload: unknown): unknown[] {
  const seen = new Set<unknown>();
  const dig = (v: unknown, depth: number): unknown[] | null => {
    if (depth > 4 || v === null || typeof v !== "object" || seen.has(v)) return null;
    seen.add(v);
    if (Array.isArray(v)) return v;
    for (const key of ["data", "items", "results", "rows", "catalog", "values"]) {
      const child = (v as Record<string, unknown>)[key];
      const hit = dig(child, depth + 1);
      if (hit) return hit;
    }
    for (const child of Object.values(v as Record<string, unknown>)) {
      const hit = dig(child, depth + 1);
      if (hit) return hit;
    }
    return null;
  };
  return dig(payload, 0) ?? [];
}
