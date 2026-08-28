// Step 5 — AudioSet ontology helpers.
//
// The upstream file (github.com/audioset/ontology -> ontology.json) is a flat
// array of nodes where hierarchy is expressed by `child_ids` (a node can appear
// under more than one parent). We flatten that into the app's dotted-code spine
// (`aset.<slug>`) with a single `parent_code`, picking the shallowest parent so
// the tree stays stable across imports.

/** Raw AudioSet ontology entry (only the fields we consume are typed). */
export interface AudioSetEntry {
  id: string;
  name: string;
  description?: string;
  child_ids?: string[];
  restrictions?: string[];
}

export interface AudioSetNode {
  code: string;
  label: string;
  parent_code: string | null;
  /** Machine id from the source file, kept for traceability. */
  mid: string;
  description: string | null;
  depth: number;
}

export const AUDIOSET_VERSION = "audioset-v1";
export const AUDIOSET_PREFIX = "aset.";

/** Prefixes crosswalked against `aset.*` (the vocabularies intuizi-ingest emits). */
export const CROSSWALK_PREFIXES = [
  "iab.",
  "ctv.genre.",
  "app.cat.",
  "poi.brand.",
] as const;

/** `Music (rock)` -> `music_rock`; stable and collision-checked by the caller. */
export function audiosetSlug(name: string): string {
  const slug = (name ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return slug.length > 0 ? slug : "unnamed";
}

function isEntry(v: unknown): v is AudioSetEntry {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return typeof o.id === "string" && typeof o.name === "string";
}

/** Accepts the raw parsed ontology.json (array, or `{ontology: [...]}`). */
export function coerceOntology(input: unknown): AudioSetEntry[] {
  const arr = Array.isArray(input)
    ? input
    : Array.isArray((input as Record<string, unknown>)?.ontology)
    ? ((input as Record<string, unknown>).ontology as unknown[])
    : null;
  if (!arr) return [];
  return arr.filter(isEntry);
}

/**
 * Flattens the ontology into insertable rows.
 * - Codes are unique: duplicate slugs get a `__2`, `__3` … suffix.
 * - Parent is the shallowest parent (BFS from the roots), so multi-parent nodes
 *   land in one deterministic place.
 * - Entries marked `abstract`/`blacklist` are kept (they are real groupings) but
 *   flagged in the returned depth ordering only.
 */
export function buildAudioSetNodes(entries: AudioSetEntry[]): AudioSetNode[] {
  const byId = new Map<string, AudioSetEntry>();
  for (const e of entries) if (!byId.has(e.id)) byId.set(e.id, e);

  const childOf = new Map<string, string>(); // child mid -> parent mid
  const hasParent = new Set<string>();
  for (const e of byId.values()) {
    for (const cid of e.child_ids ?? []) {
      if (!byId.has(cid)) continue;
      hasParent.add(cid);
    }
  }

  // BFS from roots assigns each node its shallowest parent exactly once.
  const roots = [...byId.values()].filter((e) => !hasParent.has(e.id));
  const depth = new Map<string, number>();
  const queue: Array<{ mid: string; d: number }> = roots.map((r) => ({ mid: r.id, d: 0 }));
  for (const r of roots) depth.set(r.id, 0);

  while (queue.length) {
    const { mid, d } = queue.shift()!;
    const entry = byId.get(mid);
    if (!entry) continue;
    for (const cid of entry.child_ids ?? []) {
      if (!byId.has(cid) || depth.has(cid)) continue;
      depth.set(cid, d + 1);
      childOf.set(cid, mid);
      queue.push({ mid: cid, d: d + 1 });
    }
  }

  // Cycles / unreachable nodes (shouldn't happen upstream) still get imported.
  for (const e of byId.values()) {
    if (!depth.has(e.id)) depth.set(e.id, hasParent.has(e.id) ? 1 : 0);
  }

  const codeOf = new Map<string, string>();
  const used = new Set<string>();
  const ordered = [...byId.values()].sort(
    (a, b) => (depth.get(a.id)! - depth.get(b.id)!) || a.name.localeCompare(b.name),
  );
  for (const e of ordered) {
    let slug = audiosetSlug(e.name);
    if (used.has(slug)) {
      let n = 2;
      while (used.has(`${slug}__${n}`)) n++;
      slug = `${slug}__${n}`;
    }
    used.add(slug);
    codeOf.set(e.id, `${AUDIOSET_PREFIX}${slug}`);
  }

  return ordered.map((e) => {
    const parentMid = childOf.get(e.id) ?? null;
    return {
      code: codeOf.get(e.id)!,
      label: e.name,
      parent_code: parentMid ? codeOf.get(parentMid) ?? null : null,
      mid: e.id,
      description: typeof e.description === "string" && e.description.trim().length > 0
        ? e.description.trim()
        : null,
      depth: depth.get(e.id) ?? 0,
    };
  });
}

export interface CrosswalkMatch {
  code: string;
  label: string | null;
  similarity: number;
  approved: boolean;
  rejected?: boolean;
}

export interface CrosswalkBlock {
  version: string;
  proposed_at: string;
  matches: CrosswalkMatch[];
  approved_at?: string | null;
  approved_by?: string | null;
}

/** Reads the audioset block out of a node's `crosswalk` jsonb. */
export function readCrosswalk(crosswalk: unknown): CrosswalkBlock | null {
  const o = crosswalk as Record<string, unknown> | null | undefined;
  const block = o?.audioset as Record<string, unknown> | undefined;
  if (!block || !Array.isArray(block.matches)) return null;
  return {
    version: typeof block.version === "string" ? block.version : AUDIOSET_VERSION,
    proposed_at: typeof block.proposed_at === "string" ? block.proposed_at : "",
    matches: (block.matches as unknown[]).filter((m): m is CrosswalkMatch => {
      const x = m as Record<string, unknown>;
      return !!x && typeof x.code === "string";
    }).map((m) => ({
      code: m.code,
      label: m.label ?? null,
      similarity: Number(m.similarity ?? 0),
      approved: m.approved === true,
      rejected: m.rejected === true,
    })),
    approved_at: (block.approved_at as string) ?? null,
    approved_by: (block.approved_by as string) ?? null,
  };
}

/** True when at least one proposal on the node has been approved. */
export function hasApproved(crosswalk: unknown): boolean {
  return (readCrosswalk(crosswalk)?.matches ?? []).some((m) => m.approved);
}

/**
 * Applies an approve/reject decision, preserving any other keys already stored
 * in the node's crosswalk jsonb (other vocabularies may live alongside).
 */
export function applyDecision(
  crosswalk: unknown,
  targets: string[],
  decision: "approve" | "reject" | "clear",
  actor: string | null,
): Record<string, unknown> {
  const base = (crosswalk && typeof crosswalk === "object")
    ? { ...(crosswalk as Record<string, unknown>) }
    : {};
  const block = readCrosswalk(crosswalk);
  if (!block) return base;

  const wanted = new Set(targets);
  const matches = block.matches.map((m) => {
    if (!wanted.has(m.code)) return m;
    if (decision === "approve") return { ...m, approved: true, rejected: false };
    if (decision === "reject") return { ...m, approved: false, rejected: true };
    return { ...m, approved: false, rejected: false };
  });
  const anyApproved = matches.some((m) => m.approved);

  base.audioset = {
    ...block,
    matches,
    approved_at: anyApproved ? new Date().toISOString() : null,
    approved_by: anyApproved ? actor : null,
  };
  return base;
}

/**
 * Picks the proposals an auto-approval pass should accept: the best-scoring
 * match at or above `threshold`, skipping anything a human already rejected and
 * anything already approved. Returns an empty list when nothing qualifies, so a
 * node with only weak proposals stays in the manual review queue.
 */
export function autoApproveTargets(
  crosswalk: unknown,
  threshold: number,
  maxPerNode = 1,
): string[] {
  const matches = readCrosswalk(crosswalk)?.matches ?? [];
  if (matches.some((m) => m.approved)) return [];
  return matches
    .filter((m) => !m.rejected && Number(m.similarity) >= threshold)
    .sort((a, b) => Number(b.similarity) - Number(a.similarity))
    .slice(0, Math.max(1, maxPerNode))
    .map((m) => m.code);
}



/** Text handed to CLAP for an AudioSet node (mirrors semantic-backfill wording). */
export function audiosetText(node: { label: string; description?: string | null }): string {
  const label = (node.label ?? "").trim();
  const desc = (node.description ?? "").trim();
  const body = desc.length > 0 ? `${label} — ${desc.slice(0, 220)}` : label;
  return body.length > 0 ? `the sound of ${body}` : "audio content";
}
