/**
 * Turns an arbitrary Intuizi MCP JSON payload into a digestible summary:
 * what came back, which taxonomy signals it carries, and how those signals
 * bridge into SonicSIM's 6-category semantic layer.
 *
 * Purely presentational — nothing here writes to the ingest pipeline. The
 * category tilt rules mirror `FACET_TILTS` in `identifierSignals.ts` so the
 * preview an admin sees matches how scored identifiers actually move.
 */
import { unwrap } from "@/lib/intuiziMcp";
import { CATEGORY_KEYS, type CategoryKey } from "@/lib/identifierSignals";

export const CATEGORY_META: { key: CategoryKey; name: string; color: string }[] = [
  { key: "emotional", name: "Emotional", color: "hsl(0, 70%, 60%)" },
  { key: "cognitive", name: "Cognitive", color: "hsl(210, 70%, 60%)" },
  { key: "social", name: "Social", color: "hsl(120, 50%, 50%)" },
  { key: "communication", name: "Communication", color: "hsl(45, 80%, 55%)" },
  { key: "contextual", name: "Contextual", color: "hsl(280, 60%, 60%)" },
  { key: "artistic", name: "Artistic", color: "hsl(330, 70%, 60%)" },
];

export type SignalKind =
  | "genre"
  | "content-type"
  | "channel"
  | "app"
  | "iab"
  | "brand"
  | "daypart"
  | "geo"
  | "device"
  | "audience";

export const SIGNAL_KIND_LABEL: Record<SignalKind, string> = {
  genre: "Content genres",
  "content-type": "Content types",
  channel: "Channels / networks",
  app: "Apps & categories",
  iab: "IAB taxonomy",
  brand: "Brands / POI",
  daypart: "Dayparts",
  geo: "Geography",
  device: "Devices / platforms",
  audience: "Audiences & activations",
};

/** Field-name → signal kind rules, keyed off the documented Intuizi columns. */
const FIELD_RULES: { match: RegExp; kind: SignalKind }[] = [
  { match: /^(contentgenre|content_genre|genre|genrename|genres)$/i, kind: "genre" },
  { match: /^(contenttype|content_type|programtype)$/i, kind: "content-type" },
  { match: /^(channelname|channel_name|channel|network|networkname|publisher)$/i, kind: "channel" },
  { match: /^(appname|app_name|bundle_?id|app_?id|categoryname|category_name|category|taxonomyname|taxonomy_name|taxonomy)$/i, kind: "app" },
  { match: /^(iab_?cats?|iab_categories|iab|iabcategory)$/i, kind: "iab" },
  { match: /^(brand_?name|brand|poi_?name|chain)$/i, kind: "brand" },
  { match: /^(daypart|day_part|hour|dow|weekday)$/i, kind: "daypart" },
  { match: /^(country|state|region|dma|metro|city|zip|postal_?code)$/i, kind: "geo" },
  { match: /^(device_?id|devicetype|ctv_?taxonomy|platform|os|make|model|useragent)$/i, kind: "device" },
  { match: /^(audience_?name|audience|activation_?name|activation_?id|audience_?id|cohort|segment|segment_?codes)$/i, kind: "audience" },
];

const CATEGORY_TILTS: { match: RegExp; tilt: Partial<Record<CategoryKey, number>>; why: string }[] = [
  { match: /music|audio|song|radio/i, tilt: { artistic: 8, emotional: 6, communication: -4 }, why: "music/audio consumption" },
  { match: /news|talk|podcast|spoken|speech|audiobook/i, tilt: { communication: 10, cognitive: 6, artistic: -6 }, why: "spoken-word density" },
  { match: /sport|live|event/i, tilt: { social: 8, emotional: 4, cognitive: -3 }, why: "shared live viewing" },
  { match: /kids|family|comedy/i, tilt: { social: 6, emotional: 5 }, why: "co-viewing / light tone" },
  { match: /documentar|education|learn|business|finance|tech/i, tilt: { cognitive: 9, contextual: 4, emotional: -4 }, why: "information seeking" },
  { match: /drama|movie|film|series/i, tilt: { emotional: 7, artistic: 5 }, why: "narrative immersion" },
  { match: /travel|local|visit|store|retail|auto|restaurant/i, tilt: { contextual: 9, social: 3 }, why: "place-based context" },
  { match: /morning|daytime|primetime|overnight|late ?night|evening/i, tilt: { contextual: 5 }, why: "time-of-day context" },
];

export interface SignalChip {
  kind: SignalKind;
  label: string;
  count: number;
}

export interface SemanticBridge {
  key: CategoryKey;
  name: string;
  color: string;
  /** 0-100 preview score (50 = neutral). */
  score: number;
  /** Signed tilt away from neutral. */
  tilt: number;
  drivers: string[];
}

export interface McpInsight {
  /** Short human summary of the payload shape. */
  headline: string;
  /** Top-level scalar facts (status, counts, ids). */
  facts: { label: string; value: string }[];
  /** Flattened record rows, if the payload carried a collection. */
  records: Record<string, unknown>[];
  columns: string[];
  signals: SignalChip[];
  bridges: SemanticBridge[];
  /** Signal labels that matched no bridge rule. */
  unmapped: string[];
  deliveryKeys: string[];
  raw: unknown;
}

const isObj = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);

const scalar = (v: unknown) =>
  v === null || v === undefined
    ? ""
    : typeof v === "object"
      ? ""
      : String(v).trim();

const titleize = (s: string) =>
  s.replace(/[_-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

/** Find the most row-like array in the payload. */
function findRecords(payload: unknown): Record<string, unknown>[] {
  const data = isObj(payload) ? payload.data ?? payload : payload;
  if (Array.isArray(data)) return data.filter(isObj) as Record<string, unknown>[];
  if (!isObj(data)) return [];
  for (const key of ["items", "rows", "results", "records", "values", "list"]) {
    const child = data[key];
    if (Array.isArray(child)) return child.filter(isObj) as Record<string, unknown>[];
  }
  // Single object → treat as one record.
  return [data];
}

/** Flatten one level of nested objects so `status.name` shows as a column. */
function flatten(row: Record<string, unknown>, depth = 0): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    if (isObj(v) && depth < 2) {
      for (const [ck, cv] of Object.entries(flatten(v, depth + 1))) out[`${k}.${ck}`] = cv;
    } else if (Array.isArray(v)) {
      out[k] = v.map((x) => (isObj(x) ? JSON.stringify(x) : String(x))).join(" | ");
    } else {
      out[k] = v;
    }
  }
  return out;
}

const KEY_RE = /^s3:\/\/\S+|.+\.(parquet|csv|csv\.gz|json|jsonl|gz)$/i;

/** Build the full digestible view of an MCP tool result. */
export function buildInsight(result: unknown, toolName?: string): McpInsight {
  const payload = unwrap(result) ?? result;
  const records = findRecords(payload).map((r) => flatten(r)).slice(0, 200);

  const columns: string[] = [];
  for (const r of records) {
    for (const k of Object.keys(r)) if (!columns.includes(k)) columns.push(k);
  }

  // Facts from top-level scalars of the envelope / single record.
  const facts: { label: string; value: string }[] = [];
  const factSource = isObj(payload) && isObj(payload.data) ? { ...payload, ...(payload.data as object) } : payload;
  if (isObj(factSource)) {
    for (const [k, v] of Object.entries(flatten(factSource))) {
      if (k === "data") continue;
      const s = scalar(v);
      if (!s || s.length > 80) continue;
      facts.push({ label: titleize(k), value: s });
      if (facts.length >= 10) break;
    }
  }

  // Taxonomy signals from record fields.
  const tally = new Map<string, SignalChip>();
  const deliveryKeys = new Set<string>();
  for (const row of records) {
    for (const [k, v] of Object.entries(row)) {
      const s = scalar(v);
      if (!s) continue;
      if (KEY_RE.test(s)) deliveryKeys.add(s);
      const rule = FIELD_RULES.find((r) => r.match.test(k.split(".").pop() ?? k));
      if (!rule) continue;
      for (const part of s.split(/[|,;]/).map((x) => x.trim()).filter(Boolean).slice(0, 8)) {
        if (part.length > 48) continue;
        const id = `${rule.kind}|${part.toLowerCase()}`;
        const hit = tally.get(id);
        if (hit) hit.count += 1;
        else tally.set(id, { kind: rule.kind, label: part, count: 1 });
      }
    }
  }

  const signals = Array.from(tally.values()).sort(
    (a, b) => b.count - a.count || a.label.localeCompare(b.label),
  );

  // Semantic bridge: aggregate weighted tilts across observed signals.
  const tilt: Record<CategoryKey, number> = {
    emotional: 0, cognitive: 0, social: 0, communication: 0, contextual: 0, artistic: 0,
  };
  const drivers: Record<CategoryKey, Set<string>> = {
    emotional: new Set(), cognitive: new Set(), social: new Set(),
    communication: new Set(), contextual: new Set(), artistic: new Set(),
  };
  const unmapped: string[] = [];
  let matched = 0;
  for (const sig of signals) {
    const rules = CATEGORY_TILTS.filter((r) => r.match.test(sig.label));
    if (!rules.length) {
      if (unmapped.length < 12 && sig.kind !== "audience") unmapped.push(sig.label);
      continue;
    }
    matched += 1;
    const weight = Math.min(3, Math.log10(1 + sig.count) + 1);
    for (const rule of rules) {
      for (const [k, v] of Object.entries(rule.tilt)) {
        tilt[k as CategoryKey] += (v as number) * weight;
        drivers[k as CategoryKey].add(`${sig.label} (${rule.why})`);
      }
    }
  }
  const norm = matched ? Math.max(1, matched / 2) : 1;
  const bridges: SemanticBridge[] = CATEGORY_META.map((c) => {
    const t = matched ? tilt[c.key] / norm : 0;
    return {
      ...c,
      tilt: Math.round(t * 10) / 10,
      score: Math.max(0, Math.min(100, Math.round(50 + t))),
      drivers: Array.from(drivers[c.key]).slice(0, 3),
    };
  });

  const headline = records.length > 1
    ? `${records.length} ${toolName ? `${titleize(toolName.replace(/^(list|get)_/, ""))} ` : ""}record${records.length === 1 ? "" : "s"} · ${signals.length} taxonomy signal${signals.length === 1 ? "" : "s"}`
    : records.length === 1
      ? `1 record · ${signals.length} taxonomy signal${signals.length === 1 ? "" : "s"}`
      : "No structured records in this response";

  void CATEGORY_KEYS;
  return { headline, facts, records, columns, signals, bridges, unmapped, deliveryKeys: Array.from(deliveryKeys), raw: result };
}
