// Identifier-level signal analysis for Intuizi feeds.
//
// Intuizi ships device/audience identifiers in volumes (thousands per
// activation) that are far too large — and too personally identifying — to
// display one row at a time. This module does three things:
//
//   1. Pseudonymizes every identifier so the admin UI never renders the raw
//      alphanumeric value (device UUID, activation key, hashed email, ...).
//   2. Derives a 6-category ontology vector per identifier from whatever the
//      feed carried (explicit scores, taxonomy tag codes, app/CTV facets),
//      falling back to the linked audio source's analysis.
//   3. Sub-clusters identifiers into cohorts and rolls those cohorts up into a
//      single meta sonic fingerprint, so 10K identifiers become a handful of
//      readable groups plus one population-level fingerprint.
//
// All math is deterministic (fixed seeding, no Math.random) so the same feed
// always produces the same cohort labels and colors.

import { FINGERPRINT_CATEGORIES, type FingerprintLike } from "./fingerprintMath";

export const CATEGORY_KEYS = [
  "emotional",
  "cognitive",
  "social",
  "communication",
  "contextual",
  "artistic",
] as const;

export type CategoryKey = (typeof CATEGORY_KEYS)[number];

/* ------------------------------------------------------------ input shapes */

export interface IdentifierRow {
  id: string;
  primary_identifier: string;
  tag_codes: string[] | null;
  observation_count: number | null;
  last_seen_at?: string | null;
  audio_source_id: string | null;
  ctv_signals?: unknown;
  apps_signals?: unknown;
  visitation_signals?: unknown;
  demographics_signals?: unknown;
  origin_signals?: unknown;
}

/** Baseline ontology scores for a linked audio source (from source_analyses). */
export interface SourceBaseline {
  emotional: number;
  cognitive: number;
  social: number;
  communication: number;
  contextual: number;
  artistic: number;
  confidence: number;
}

/* --------------------------------------------------------- pseudonymization */

/**
 * Stable, non-displayable-input pseudonym for an identifier.
 *
 * FNV-1a over the raw identifier, rendered in Crockford-ish base32. The raw
 * value never leaves this function, so nothing downstream can leak it into the
 * DOM. Not a security boundary (identifiers stay readable in the database for
 * admins with SQL access) — it keeps the dashboard from rendering PII-shaped
 * strings and keeps rows visually distinguishable.
 */
export function pseudonym(raw: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < raw.length; i++) {
    h ^= raw.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  const alphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
  let out = "";
  let n = h;
  for (let i = 0; i < 6; i++) {
    out = alphabet[n % 32] + out;
    n = Math.floor(n / 32);
  }
  return `SIG-${out}`;
}

/* ------------------------------------------------------------------- facets */

export type FacetKind = "activation" | "app" | "ctv" | "visitation" | "demographic" | "origin" | "scope";

export interface Facet {
  kind: FacetKind;
  /** Human label — already safe to display. */
  label: string;
}

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function asRows(v: unknown): Record<string, unknown>[] {
  const rec = asRecord(v);
  const rows = rec.rows;
  return Array.isArray(rows) ? (rows.filter((r) => r && typeof r === "object") as Record<string, unknown>[]) : [];
}

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : v == null ? "" : String(v).trim();
}

/** Pull display-safe facets out of an identifier's signal blobs. */
export function extractFacets(row: IdentifierRow): Facet[] {
  const facets: Facet[] = [];
  const seen = new Set<string>();
  const push = (kind: FacetKind, label: string) => {
    const clean = label.trim();
    if (!clean) return;
    const key = `${kind}|${clean.toLowerCase()}`;
    if (seen.has(key)) return;
    seen.add(key);
    facets.push({ kind, label: clean });
  };

  const blobs: [FacetKind, unknown][] = [
    ["app", row.apps_signals],
    ["ctv", row.ctv_signals],
    ["visitation", row.visitation_signals],
    ["demographic", row.demographics_signals],
    ["origin", row.origin_signals],
  ];

  for (const [kind, blob] of blobs) {
    const rec = asRecord(blob);
    const activation = str(rec.activation_id);
    if (activation) push("activation", `Activation ${activation}`);
    const scope = str(rec.scope);
    if (scope) push("scope", scope.replace(/_/g, " "));

    for (const r of asRows(blob)) {
      push(kind, str(r.CategoryName) || str(r.GenreName) || str(r.TaxonomyName) || str(r.Name));
      const daypart = str(r.Daypart) || str(r.daypart);
      if (daypart) push("ctv", daypart);
      const network = str(r.NetworkName) || str(r.AppName);
      if (network) push(kind, network);
    }
  }

  for (const code of row.tag_codes ?? []) {
    // "app.category.music-audio" -> "music audio"
    const leaf = str(code).split(".").pop() || "";
    if (leaf) push(str(code).startsWith("ctv") ? "ctv" : "app", leaf.replace(/-/g, " "));
  }

  return facets;
}

/* ------------------------------------------------ per-identifier ontology */

/** Category tilts applied when a facet keyword is present (points, pre-clamp). */
const FACET_TILTS: { match: RegExp; tilt: Partial<Record<CategoryKey, number>> }[] = [
  { match: /music|audio|song|radio/i, tilt: { artistic: 8, emotional: 6, communication: -4 } },
  { match: /news|talk|podcast|spoken|speech|audiobook/i, tilt: { communication: 10, cognitive: 6, artistic: -6 } },
  { match: /sport|live|event/i, tilt: { social: 8, emotional: 4, cognitive: -3 } },
  { match: /kids|family|comedy/i, tilt: { social: 6, emotional: 5 } },
  { match: /documentar|education|learn|business|finance/i, tilt: { cognitive: 9, contextual: 4, emotional: -4 } },
  { match: /drama|movie|film|series/i, tilt: { emotional: 7, artistic: 5 } },
  { match: /travel|local|visit|store|retail|auto/i, tilt: { contextual: 9, social: 3 } },
  { match: /morning|daytime|primetime|overnight|late night/i, tilt: { contextual: 5 } },
];

const NEUTRAL: SourceBaseline = {
  emotional: 50,
  cognitive: 50,
  social: 50,
  communication: 50,
  contextual: 50,
  artistic: 50,
  confidence: 0.15,
};

function clamp(v: number): number {
  return Math.max(0, Math.min(100, v));
}

/** Explicit scores carried on a signal blob, if the ingest scored this row. */
function explicitScores(row: IdentifierRow): SourceBaseline | null {
  for (const blob of [row.apps_signals, row.ctv_signals, row.visitation_signals]) {
    const scores = asRecord(asRecord(blob).scores);
    if (!Object.keys(scores).length) continue;
    const vals = CATEGORY_KEYS.map((k) => Number(scores[k]));
    if (vals.some((v) => !Number.isFinite(v))) continue;
    const conf = Number(asRecord(blob).confidence);
    return {
      emotional: clamp(vals[0]),
      cognitive: clamp(vals[1]),
      social: clamp(vals[2]),
      communication: clamp(vals[3]),
      contextual: clamp(vals[4]),
      artistic: clamp(vals[5]),
      confidence: Number.isFinite(conf) ? Math.max(0, Math.min(1, conf)) : 0.6,
    };
  }
  return null;
}

export interface SignalPoint {
  id: string;
  /** Display label — the raw identifier is never carried on this object. */
  label: string;
  vector: number[];
  facets: Facet[];
  observations: number;
  confidence: number;
  /** Where the ontology vector came from, for honest UI labelling. */
  basis: "scored" | "inherited" | "facet-only";
  lastSeenAt: string | null;
}

/**
 * Build a display-safe, scored point per identifier.
 *
 * Precedence: scores written by the ingest > the linked audio source's
 * analysis, tilted by this identifier's own facets > neutral + facet tilt.
 */
export function buildSignalPoints(
  rows: IdentifierRow[],
  baselines: Record<string, SourceBaseline>,
): SignalPoint[] {
  return rows.map((row) => {
    const facets = extractFacets(row);
    const explicit = explicitScores(row);
    const inherited = row.audio_source_id ? baselines[row.audio_source_id] : undefined;
    const base = explicit ?? inherited ?? NEUTRAL;
    const basis: SignalPoint["basis"] = explicit ? "scored" : inherited ? "inherited" : "facet-only";

    const tilt: Record<CategoryKey, number> = {
      emotional: 0, cognitive: 0, social: 0, communication: 0, contextual: 0, artistic: 0,
    };
    // Facet tilts only differentiate identifiers that came in without their own
    // scores; a scored row is already specific to this identifier.
    if (!explicit) {
      for (const f of facets) {
        for (const rule of FACET_TILTS) {
          if (!rule.match.test(f.label)) continue;
          for (const [k, v] of Object.entries(rule.tilt)) {
            tilt[k as CategoryKey] += v as number;
          }
        }
      }
    }

    const vector = CATEGORY_KEYS.map((k) => clamp(base[k] + tilt[k]));
    const tiltMagnitude = CATEGORY_KEYS.reduce((s, k) => s + Math.abs(tilt[k]), 0);

    return {
      id: row.id,
      label: pseudonym(row.primary_identifier),
      vector,
      facets,
      observations: Math.max(1, Number(row.observation_count) || 1),
      // Inherited vectors with no facet evidence are the weakest signal we have.
      confidence: explicit
        ? base.confidence
        : Math.max(0.05, Math.min(0.9, base.confidence * (tiltMagnitude > 0 ? 0.75 : 0.4))),
      basis,
      lastSeenAt: row.last_seen_at ?? null,
    };
  });
}

/* -------------------------------------------------------------- clustering */

export interface SignalCohort {
  key: string;
  /** "Cohort A" plus its strongest shared facet, e.g. "Cohort A · music audio". */
  label: string;
  letter: string;
  centroid: number[];
  members: SignalPoint[];
  /** Share of all identifiers in this cohort (0-1). */
  share: number;
  /** 0-1, higher = members sit tighter around the centroid. */
  cohesion: number;
  dominantCategory: string;
  topFacets: { label: string; count: number }[];
  observations: number;
  avgConfidence: number;
  scoredMembers: number;
  /** Activation/scope signature shared by every member. */
  signature: string;
  /** True when the feed carries no detail that could split this group further. */
  undifferentiated: boolean;
}

const MAX_DIST = Math.sqrt(CATEGORY_KEYS.length * 100 * 100);

function distance(a: number[], b: number[]): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += (a[i] - b[i]) ** 2;
  return Math.sqrt(s);
}

/** Suggested cohort count for n identifiers, capped so the UI stays readable. */
export function suggestedK(n: number): number {
  if (n < 4) return 1;
  return Math.max(2, Math.min(6, Math.round(Math.sqrt(n / 2))));
}

/**
 * k-means over the 6-d ontology vectors, seeded deterministically with
 * k-means++-style farthest-point picks so cohorts are stable across renders.
 */
function kmeans(points: SignalPoint[], k: number): number[] {
  const n = points.length;
  const assign = new Array(n).fill(0);
  if (k <= 1 || n <= k) return points.map((_, i) => (n <= k ? i : 0));

  // Seed: start from the point nearest the global mean, then repeatedly take
  // the point farthest from every chosen seed.
  const mean = points[0].vector.map((_, d) => points.reduce((s, p) => s + p.vector[d], 0) / n);
  let firstIdx = 0;
  let bestD = Infinity;
  points.forEach((p, i) => {
    const d = distance(p.vector, mean);
    if (d < bestD) { bestD = d; firstIdx = i; }
  });
  const centroids: number[][] = [[...points[firstIdx].vector]];
  while (centroids.length < k) {
    let pick = 0;
    let far = -1;
    points.forEach((p, i) => {
      const d = Math.min(...centroids.map((c) => distance(p.vector, c)));
      if (d > far) { far = d; pick = i; }
    });
    centroids.push([...points[pick].vector]);
  }

  for (let iter = 0; iter < 25; iter++) {
    let moved = false;
    points.forEach((p, i) => {
      let best = 0;
      let bd = Infinity;
      centroids.forEach((c, ci) => {
        const d = distance(p.vector, c);
        if (d < bd) { bd = d; best = ci; }
      });
      if (assign[i] !== best) { assign[i] = best; moved = true; }
    });
    for (let ci = 0; ci < k; ci++) {
      const members = points.filter((_, i) => assign[i] === ci);
      if (!members.length) continue;
      centroids[ci] = members[0].vector.map(
        (_, d) => members.reduce((s, m) => s + m.vector[d], 0) / members.length,
      );
    }
    if (!moved) break;
  }
  return assign;
}

const LETTERS = "ABCDEFGH";

/** Facet signature: identifiers sharing one are from the same feed slice. */
function signatureOf(p: SignalPoint): string {
  const parts = p.facets
    .filter((f) => f.kind === "activation" || f.kind === "scope")
    .map((f) => f.label)
    .sort();
  return parts.length ? parts.join(" · ") : "unattributed";
}

/**
 * Sub-cluster identifiers into cohorts, largest first.
 *
 * Two stages, because Intuizi roster rows frequently carry no per-identifier
 * detail at all (just activation + scope):
 *   1. Partition by facet signature — always meaningful, never fabricated.
 *   2. Split partitions whose ontology vectors actually vary with k-means,
 *      spending the requested cohort budget on the largest varied partitions.
 *
 * A partition whose members share an identical vector stays one cohort and is
 * flagged `undifferentiated`, so the UI can say the feed lacks the detail
 * needed to split it further instead of inventing arbitrary groups.
 */
export function clusterSignals(points: SignalPoint[], k?: number): SignalCohort[] {
  if (!points.length) return [];
  const budget = Math.max(1, Math.min(k ?? suggestedK(points.length), 8));

  // Stage 1: facet-signature partitions.
  const partitions = new Map<string, SignalPoint[]>();
  points.forEach((p) => {
    const sig = signatureOf(p);
    const g = partitions.get(sig) ?? [];
    g.push(p);
    partitions.set(sig, g);
  });

  const varies = (group: SignalPoint[]) =>
    group.some((m) => distance(m.vector, group[0].vector) > 1e-6);

  let groups: { members: SignalPoint[]; signature: string; undifferentiated: boolean }[] =
    Array.from(partitions.entries()).map(([signature, members]) => ({
      members,
      signature,
      undifferentiated: !varies(members),
    }));

  // Stage 2: spend the remaining cohort budget splitting varied partitions.
  let guard = 0;
  while (groups.length < budget && guard++ < 16) {
    const candidates = groups
      .map((g, i) => ({ g, i }))
      .filter(({ g }) => !g.undifferentiated && g.members.length >= 4)
      .sort((a, b) => b.g.members.length - a.g.members.length);
    if (!candidates.length) break;

    const { g, i } = candidates[0];
    const assign = kmeans(g.members, 2);
    const left = g.members.filter((_, idx) => assign[idx] === 0);
    const right = g.members.filter((_, idx) => assign[idx] === 1);
    if (!left.length || !right.length) {
      groups[i] = { ...g, undifferentiated: true };
      continue;
    }
    groups = [
      ...groups.slice(0, i),
      { members: left, signature: g.signature, undifferentiated: !varies(left) },
      { members: right, signature: g.signature, undifferentiated: !varies(right) },
      ...groups.slice(i + 1),
    ];
  }

  const cohorts = groups
    .filter(({ members }) => members.length > 0)
    .map(({ members, signature, undifferentiated }) => {
      const centroid = members[0].vector.map(
        (_, d) => members.reduce((s, m) => s + m.vector[d], 0) / members.length,
      );
      const avgDist = members.reduce((s, m) => s + distance(m.vector, centroid), 0) / members.length;
      const facetCounts = new Map<string, number>();
      members.forEach((m) =>
        m.facets.forEach((f) => facetCounts.set(f.label, (facetCounts.get(f.label) ?? 0) + 1)),
      );
      const topFacets = Array.from(facetCounts.entries())
        .map(([label, count]) => ({ label, count }))
        .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
        .slice(0, 4);

      let domIdx = 0;
      centroid.forEach((v, i) => { if (v > centroid[domIdx]) domIdx = i; });

      return {
        centroid,
        signature,
        undifferentiated,
        members: members.slice().sort((a, b) => b.observations - a.observations || a.label.localeCompare(b.label)),
        share: members.length / points.length,
        cohesion: Math.max(0, 1 - avgDist / MAX_DIST),
        dominantCategory: FINGERPRINT_CATEGORIES[domIdx].name,
        topFacets,
        observations: members.reduce((s, m) => s + m.observations, 0),
        avgConfidence: members.reduce((s, m) => s + m.confidence, 0) / members.length,
        scoredMembers: members.filter((m) => m.basis === "scored").length,
      };
    })
    .sort((a, b) => b.members.length - a.members.length);

  return cohorts.map((c, i) => {
    const letter = LETTERS[i] ?? String(i + 1);
    const facet = c.topFacets[0]?.label ?? (c.signature !== "unattributed" ? c.signature : undefined);
    return {
      ...c,
      key: `cohort:${letter}`,
      letter,
      label: facet ? `Cohort ${letter} · ${facet}` : `Cohort ${letter}`,
    };
  });
}

/* ------------------------------------------------------------ meta rollup */

export interface MetaFingerprint extends FingerprintLike {
  user_id: string;
  username: string;
  avatar_url: null;
  total_sources_analyzed: number;
  recent_sources_analyzed: number;
  fingerprint_confidence: number;
  /** Cohort spread: how far apart the cohort centroids sit (0-100). */
  dispersionPct: number;
  cohortCount: number;
  identifierCount: number;
}

function toFingerprint(vector: number[]): FingerprintLike {
  const [emotional, cognitive, social, communication, contextual, artistic] = vector;
  return {
    emotional_avg: emotional,
    cognitive_avg: cognitive,
    social_avg: social,
    communication_avg: communication,
    contextual_avg: contextual,
    artistic_avg: artistic,
    emotional_avg_recent: emotional,
    cognitive_avg_recent: cognitive,
    social_avg_recent: social,
    communication_avg_recent: communication,
    contextual_avg_recent: contextual,
    artistic_avg_recent: artistic,
  };
}

/**
 * Cohort-level fingerprint, shaped like a user fingerprint so it can flow
 * straight into the existing aggregate/compare visualizations.
 */
export function cohortFingerprint(cohort: SignalCohort) {
  return {
    ...toFingerprint(cohort.centroid),
    id: cohort.key,
    user_id: cohort.key,
    username: cohort.label,
    avatar_url: null,
    total_sources_analyzed: cohort.members.length,
    recent_sources_analyzed: cohort.members.length,
    fingerprint_confidence: Number((cohort.avgConfidence * cohort.cohesion).toFixed(3)),
  };
}

/**
 * Roll cohorts up into one meta sonic fingerprint, weighted by cohort size so
 * a 5-identifier outlier cohort cannot dominate a 5,000-identifier one.
 */
export function metaFingerprint(cohorts: SignalCohort[], scopeLabel = "Meta fingerprint"): MetaFingerprint | null {
  if (!cohorts.length) return null;
  const totalMembers = cohorts.reduce((s, c) => s + c.members.length, 0);
  const vector = cohorts[0].centroid.map(
    (_, d) => cohorts.reduce((s, c) => s + c.centroid[d] * c.members.length, 0) / totalMembers,
  );
  const dispersion = cohorts.length < 2
    ? 0
    : (cohorts.reduce((s, c) => s + distance(c.centroid, vector) * c.members.length, 0) / totalMembers) / MAX_DIST * 100;
  const weightedConfidence =
    cohorts.reduce((s, c) => s + c.avgConfidence * c.members.length, 0) / totalMembers;

  return {
    ...toFingerprint(vector),
    user_id: "meta:all",
    username: scopeLabel,
    avatar_url: null,
    total_sources_analyzed: totalMembers,
    recent_sources_analyzed: totalMembers,
    // Wide cohort spread means the population is genuinely mixed, so the single
    // rolled-up vector describes it less well.
    fingerprint_confidence: Number(
      Math.max(0, Math.min(1, weightedConfidence * (1 - dispersion / 100))).toFixed(3),
    ),
    dispersionPct: Number(dispersion.toFixed(1)),
    cohortCount: cohorts.length,
    identifierCount: totalMembers,
  };
}
