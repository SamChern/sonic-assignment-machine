/**
 * Client-side mirror of the ingest normalizer's field → taxonomy-tag rules
 * (`supabase/functions/_shared/intuizi.ts`). Used by the "Inspect mapping" view
 * so an admin can see exactly which row fields produced which taxonomy nodes
 * and tag weights. Keep in sync with the edge function when rules change.
 */

export const REPORT_TYPES = [
  "ctv",
  "apps",
  "visitation",
  "demographics",
  "origin",
] as const;
export type ReportType = (typeof REPORT_TYPES)[number];

export interface MappedTag {
  code: string;
  label: string;
  parent_code: string;
}

export interface FieldMapping {
  /** Canonical field name as documented in the taxonomy guides. */
  field: string;
  /** Accepted column aliases, in resolution order. */
  aliases: string[];
  /** Which alias actually matched the inspected row. */
  matchedAlias: string | null;
  value: string | string[] | null;
  /** Tags this field contributed. */
  tags: MappedTag[];
  /** Role of the field in the pipeline. */
  role: "tag" | "confidence" | "metadata" | "join-key";
  note?: string;
}

export interface MappingResult {
  reportType: ReportType;
  identifier: string | null;
  label: string;
  confidence: number;
  confidenceReason: string;
  fields: FieldMapping[];
  tags: MappedTag[];
  /** Weight written to audio_source_tags for every tag of this identifier. */
  tagWeight: number;
  skippedReason: string | null;
}

const slug = (v: string) =>
  v.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);

const multi = (v: string) =>
  !v ? [] : v.split(/[|,;]/).map((s) => s.trim()).filter(Boolean).slice(0, 8);

const daypart = (iso: string) => {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const h = d.getUTCHours();
  if (h < 6) return "overnight";
  if (h < 12) return "morning";
  if (h < 17) return "afternoon";
  if (h < 22) return "primetime";
  return "latenight";
};

const lookup = (
  row: Record<string, unknown>,
  aliases: string[],
): { alias: string | null; value: string } => {
  const lowerKeys = new Map(Object.keys(row).map((k) => [k.toLowerCase(), k]));
  for (const alias of aliases) {
    const key = lowerKeys.get(alias.toLowerCase());
    if (key === undefined) continue;
    const raw = row[key];
    if (raw === null || raw === undefined) continue;
    const value = String(raw).trim();
    if (!value) continue;
    return { alias: key, value };
  }
  return { alias: null, value: "" };
};

const IDENTIFIER_ALIASES = [
  "primary_identifier",
  "primaryidentifier",
  "eid",
  "maid",
  "hem",
  "device_id",
];

/** Field alias tables per report type, mirroring the normalizer. */
export const FIELD_SPECS: Record<
  ReportType,
  { field: string; aliases: string[]; role: FieldMapping["role"]; note?: string }[]
> = {
  ctv: [
    { field: "contentgenre", aliases: ["contentgenre", "content_genre", "genre"], role: "tag", note: "→ ctv.genre.*" },
    { field: "contenttype", aliases: ["contenttype", "content_type"], role: "tag", note: "→ ctv.type.*" },
    { field: "channelname", aliases: ["channelname", "channel_name", "network", "domain", "site"], role: "tag", note: "web `domain` maps here → ctv.channel.*" },
    { field: "iab_cats", aliases: ["iab_cats", "iab_categories", "iabcats", "iab_codes", "iabcodes"], role: "tag", note: "multi-value, max 8 → iab.*" },
    { field: "page", aliases: ["page", "path", "url"], role: "tag", note: "path tokens, max 2 → web.topic.*" },
    { field: "ref", aliases: ["ref", "referrer", "referer"], role: "tag", note: "host only → web.referrer.*" },
    { field: "signals", aliases: ["signals", "signal_count", "impressions"], role: "confidence", note: "0.5 + log10(1+n)/4, capped at 1" },
    { field: "device_id", aliases: ["ctv_taxonomy", "device_id", "deviceid"], role: "metadata" },
    { field: "useragent", aliases: ["useragent", "user_agent"], role: "metadata" },
  ],

  apps: [
    { field: "CategoryName", aliases: ["CategoryName", "category_name", "category"], role: "tag", note: "→ app.category.*" },
    { field: "TaxonomyName", aliases: ["TaxonomyName", "taxonomy_name", "taxonomy"], role: "tag", note: "→ app.taxonomy.*" },
    { field: "Signals", aliases: ["Signals", "signals", "signal_count"], role: "confidence", note: "0.5 + log10(1+n)/4, capped at 1" },
    { field: "bundle_id", aliases: ["bundle_id", "bundleid", "app_id"], role: "metadata" },
    { field: "platform", aliases: ["platform", "os"], role: "metadata" },
  ],
  visitation: [
    { field: "brandName", aliases: ["brandName", "brand_name", "brand"], role: "tag", note: "→ visit.brand.*" },
    { field: "d_utc", aliases: ["d_utc", "timestamp", "visit_time"], role: "tag", note: "bucketed to daypart → visit.daypart.*" },
    { field: "distance", aliases: ["distance", "dist_m"], role: "confidence", note: "≤25m 0.9 · ≤100m 0.7 · ≤250m 0.5 · else 0.35" },
    { field: "poi_id", aliases: ["poi_id", "poiid", "location_id"], role: "metadata" },
  ],
  demographics: [
    { field: "age_range", aliases: ["age_range", "agerange", "age_band", "age"], role: "tag", note: "→ demo.age.*" },
    { field: "income_range", aliases: ["income_range", "income_band", "income"], role: "tag", note: "→ demo.income.*" },
    { field: "household_composition", aliases: ["household_composition", "household", "family_status", "marital_status"], role: "tag", note: "→ demo.household.*" },
    { field: "segment_codes", aliases: ["segment_codes", "segments"], role: "metadata" },
  ],
  origin: [
    { field: "origin_type", aliases: ["origin_type", "location_type", "place_type", "type"], role: "tag", note: "→ origin.class.*" },
    { field: "region", aliases: ["state", "region", "dma", "metro", "city"], role: "tag", note: "→ origin.region.*" },
    { field: "travel_type", aliases: ["travel_type", "travel", "distance_band"], role: "tag", note: "→ origin.travel.*" },
    { field: "country", aliases: ["country"], role: "metadata" },
    { field: "provider", aliases: ["provider"], role: "metadata" },
  ],
};

/** Explain how a single raw row maps into taxonomy nodes and tag weights. */
export function inspectRow(
  reportType: ReportType,
  row: Record<string, unknown>,
): MappingResult {
  const idHit = lookup(row, IDENTIFIER_ALIASES);
  const fields: FieldMapping[] = [
    {
      field: "primary_identifier",
      aliases: IDENTIFIER_ALIASES,
      matchedAlias: idHit.alias,
      value: idHit.value || null,
      tags: [],
      role: "join-key",
      note: "join key only — never a semantic feature",
    },
  ];

  const tags: MappedTag[] = [];
  let confidence = 0.7;
  let confidenceReason = "default base confidence (0.7)";
  const labelParts: string[] = [];

  const spec = FIELD_SPECS[reportType];
  for (const s of spec) {
    const hit = lookup(row, s.aliases);
    const fieldTags: MappedTag[] = [];
    let value: string | string[] | null = hit.value || null;

    if (hit.value && s.role === "tag") {
      if (reportType === "ctv") {
        if (s.field === "contentgenre")
          fieldTags.push({ code: `ctv.genre.${slug(hit.value)}`, label: `CTV genre: ${hit.value}`, parent_code: "ctv.genre" });
        if (s.field === "contenttype")
          fieldTags.push({ code: `ctv.type.${slug(hit.value)}`, label: `CTV content type: ${hit.value}`, parent_code: "ctv.type" });
        if (s.field === "channelname")
          fieldTags.push({ code: `ctv.channel.${slug(hit.value)}`, label: `CTV channel: ${hit.value}`, parent_code: "ctv.channel" });
        if (s.field === "iab_cats") {
          const cats = multi(hit.value);
          value = cats;
          for (const c of cats)
            fieldTags.push({ code: `iab.${slug(c)}`, label: `IAB category ${c}`, parent_code: "iab" });
        }
        if (s.field === "page") {
          const topics = pathTopics(hit.value);
          value = topics.length ? topics : hit.value;
          for (const t of topics)
            fieldTags.push({ code: `web.topic.${slug(t)}`, label: `Web topic: ${t}`, parent_code: "web.topic" });
        }
        if (s.field === "ref") {
          const host = hostOf(hit.value);
          value = host || hit.value;
          if (host)
            fieldTags.push({ code: `web.referrer.${slug(host)}`, label: `Referrer: ${host}`, parent_code: "web.referrer" });
        }

      } else if (reportType === "apps") {
        if (s.field === "CategoryName")
          fieldTags.push({ code: `app.category.${slug(hit.value)}`, label: `App category: ${hit.value}`, parent_code: "app.category" });
        if (s.field === "TaxonomyName")
          fieldTags.push({ code: `app.taxonomy.${slug(hit.value)}`, label: `App taxonomy: ${hit.value}`, parent_code: "app.taxonomy" });
      } else if (reportType === "visitation") {
        if (s.field === "brandName")
          fieldTags.push({ code: `visit.brand.${slug(hit.value)}`, label: `Visited brand: ${hit.value}`, parent_code: "visit.brand" });
        if (s.field === "d_utc") {
          const dp = daypart(hit.value);
          value = dp ? `${hit.value} → ${dp}` : hit.value;
          if (dp)
            fieldTags.push({ code: `visit.daypart.${dp}`, label: `Visit daypart: ${dp}`, parent_code: "visit.daypart" });
        }
      } else if (reportType === "demographics") {
        if (s.field === "age_range")
          fieldTags.push({ code: `demo.age.${slug(hit.value)}`, label: `Age band: ${hit.value}`, parent_code: "demo.age" });
        if (s.field === "income_range")
          fieldTags.push({ code: `demo.income.${slug(hit.value)}`, label: `Income band: ${hit.value}`, parent_code: "demo.income" });
        if (s.field === "household_composition")
          fieldTags.push({ code: `demo.household.${slug(hit.value)}`, label: `Household: ${hit.value}`, parent_code: "demo.household" });
      } else {
        if (s.field === "origin_type")
          fieldTags.push({ code: `origin.class.${slug(hit.value)}`, label: `Origin class: ${hit.value}`, parent_code: "origin.class" });
        if (s.field === "region")
          fieldTags.push({ code: `origin.region.${slug(hit.value)}`, label: `Origin region: ${hit.value}`, parent_code: "origin.region" });
        if (s.field === "travel_type")
          fieldTags.push({ code: `origin.travel.${slug(hit.value)}`, label: `Travel context: ${hit.value}`, parent_code: "origin.travel" });
      }
      tags.push(...fieldTags);
    }

    if (hit.value && s.role === "confidence") {
      if (reportType === "apps") {
        const n = Number(hit.value);
        if (Number.isFinite(n) && n > 0) {
          confidence = Math.min(1, 0.5 + Math.log10(1 + n) / 4);
          confidenceReason = `Signals=${n} → 0.5 + log10(1+${n})/4`;
        }
      } else if (reportType === "visitation") {
        const d = Number(hit.value);
        if (Number.isFinite(d)) {
          confidence = d <= 25 ? 0.9 : d <= 100 ? 0.7 : d <= 250 ? 0.5 : 0.35;
          confidenceReason = `distance=${d}m → ${confidence}`;
        }
      } else if (reportType === "ctv") {
        const n = Number(hit.value);
        if (Number.isFinite(n) && n > 0) {
          confidence = Math.min(1, 0.5 + Math.log10(1 + n) / 4);
          confidenceReason = `signals=${n} → 0.5 + log10(1+${n})/4`;
        }
      }
    }


    fields.push({
      field: s.field,
      aliases: s.aliases,
      matchedAlias: hit.alias,
      value,
      tags: fieldTags,
      role: s.role,
      note: s.note,
    });
  }

  // Display label, matching the normalizer's label composition.
  const get = (field: string) => {
    const f = fields.find((x) => x.field === field);
    return typeof f?.value === "string" ? f.value : null;
  };
  if (reportType === "ctv") labelParts.push(get("channelname") ?? "", get("contentgenre") ?? "", get("contenttype") ?? "");
  else if (reportType === "apps") labelParts.push(get("CategoryName") ?? "", get("TaxonomyName") ?? "");
  else if (reportType === "visitation") labelParts.push(get("brandName") ?? "", daypart(get("d_utc")?.split(" → ")[0] ?? ""));
  else if (reportType === "demographics") labelParts.push(get("age_range") ?? "", get("income_range") ?? "");
  else labelParts.push(get("region") ?? "", get("origin_type") ?? "");

  const fallback: Record<ReportType, string> = {
    ctv: "CTV impression",
    apps: "App affinity",
    visitation: "Visitation",
    demographics: "Demographics",
    origin: "Origin",
  };

  return {
    reportType,
    identifier: idHit.value || null,
    label: labelParts.filter(Boolean).join(" · ") || fallback[reportType],
    confidence,
    confidenceReason,
    fields,
    tags,
    tagWeight: confidence,
    skippedReason: !idHit.value
      ? "row skipped: no primary identifier found"
      : tags.length === 0
        ? "row skipped: no taxonomy tags could be derived"
        : null,
  };
}

/** Parse a single-row CSV (header + row) or a JSON object into a row record. */
export function parseRowInput(input: string): Record<string, unknown> | null {
  const text = input.trim();
  if (!text) return null;
  if (text.startsWith("{")) {
    try {
      const parsed = JSON.parse(text);
      return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
    } catch {
      return null;
    }
  }
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return null;
  const split = (l: string) =>
    l.split(",").map((c) => c.trim().replace(/^"|"$/g, ""));
  const header = split(lines[0]);
  const values = split(lines[1]);
  const row: Record<string, unknown> = {};
  header.forEach((h, i) => {
    if (h) row[h] = values[i] ?? "";
  });
  return row;
}
