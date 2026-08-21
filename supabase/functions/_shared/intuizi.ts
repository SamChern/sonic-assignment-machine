// Intuizi report normalization: S3 prefix layout, file parsing (CSV / gzip CSV),
// and the field→tag mapping per report type.
//
// Only fields with ontological signal become taxonomy tags. Join keys and
// precise geo/device values are carried as metadata and never used as features.

import type { OntologyTag } from "./ontology.ts";

export const REPORT_TYPES = [
  "ctv",
  "apps",
  "visitation",
  "demographics",
  "origin",
] as const;
export type ReportType = typeof REPORT_TYPES[number];

export interface NormalizedRow {
  primary_identifier: string;
  report_type: ReportType;
  tags: OntologyTag[];
  signals: Record<string, unknown>;
  /** 0..1 — lowers the weight of noisy observations (e.g. far-from-POI visits). */
  confidence: number;
  label: string;
}

/* ------------------------------------------------------------------ parsing */

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; } else { inQuotes = false; }
      } else cur += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ",") { out.push(cur); cur = ""; }
    else cur += ch;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

export function parseCsv(text: string): Record<string, string>[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) return [];
  const header = splitCsvLine(lines[0]).map((h) => h.replace(/^"|"$/g, ""));
  const rows: Record<string, string>[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = splitCsvLine(lines[i]);
    const row: Record<string, string> = {};
    header.forEach((h, idx) => { row[h] = cells[idx] ?? ""; });
    rows.push(row);
  }
  return rows;
}

/**
 * Fetch an object and decode it to raw rows.
 * Handles .csv, .csv.gz, .json(l) and .parquet (snappy/gzip/zstd/brotli).
 */
export async function fetchObjectRows(
  url: string,
  objectKey: string,
  maxRows = 5000,
): Promise<Record<string, unknown>[]> {
  const lower = objectKey.toLowerCase();

  if (lower.endsWith(".parquet") || lower.endsWith(".pq")) {
    return await readParquetRows(url, maxRows);
  }

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`object fetch failed [${res.status}]: ${await res.text()}`);
  }

  let text: string;
  if (lower.endsWith(".gz")) {
    const stream = res.body?.pipeThrough(new DecompressionStream("gzip"));
    if (!stream) throw new Error("empty gzip body");
    text = await new Response(stream).text();
  } else {
    text = await res.text();
  }

  if (lower.includes(".jsonl") || lower.includes(".ndjson")) {
    return text.split(/\r?\n/).filter((l) => l.trim()).map((l) => JSON.parse(l));
  }
  if (lower.replace(/\.gz$/, "").endsWith(".json")) {
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? parsed : (parsed.rows ?? []);
  }
  return parseCsv(text);
}


/* ------------------------------------------------------------------ helpers */

function pick(row: Record<string, unknown>, ...keys: string[]): string {
  for (const k of keys) {
    // case-insensitive lookup
    const hit = Object.keys(row).find((rk) => rk.toLowerCase() === k.toLowerCase());
    if (hit) {
      const v = row[hit];
      if (v !== undefined && v !== null && String(v).trim() !== "") return String(v).trim();
    }
  }
  return "";
}

function slug(v: string): string {
  return v.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
}

function multi(v: string): string[] {
  if (!v) return [];
  return v.split(/[|,;]/).map((s) => s.trim()).filter(Boolean).slice(0, 8);
}

function daypart(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const h = d.getUTCHours();
  if (h < 6) return "overnight";
  if (h < 12) return "morning";
  if (h < 17) return "afternoon";
  if (h < 22) return "primetime";
  return "latenight";
}

/** The join key. Never a feature. */
export function identifierOf(row: Record<string, unknown>): string {
  return pick(row, "primary_identifier", "primaryidentifier", "eid", "maid", "hem", "device_id");
}

/* ---------------------------------------------------------------- mappings */

export function normalizeRow(
  reportType: ReportType,
  row: Record<string, unknown>,
): NormalizedRow | null {
  const id = identifierOf(row);
  if (!id) return null;

  const tags: OntologyTag[] = [];
  const signals: Record<string, unknown> = {};
  let confidence = 0.7;
  let label = "";

  if (reportType === "ctv") {
    const genre = pick(row, "contentgenre", "content_genre", "genre");
    const type = pick(row, "contenttype", "content_type");
    const channel = pick(row, "channelname", "channel_name", "network");
    const iab = multi(pick(row, "iab_cats", "iab_categories", "iabcats"));
    if (genre) tags.push({ code: `ctv.genre.${slug(genre)}`, label: `CTV genre: ${genre}`, parent_code: "ctv.genre" });
    if (type) tags.push({ code: `ctv.type.${slug(type)}`, label: `CTV content type: ${type}`, parent_code: "ctv.type" });
    if (channel) tags.push({ code: `ctv.channel.${slug(channel)}`, label: `CTV channel: ${channel}`, parent_code: "ctv.channel" });
    for (const c of iab) tags.push({ code: `iab.${slug(c)}`, label: `IAB category ${c}`, parent_code: "iab" });
    Object.assign(signals, { contentgenre: genre, contenttype: type, channelname: channel, iab_cats: iab });
    // metadata only
    signals.meta = {
      device_id: pick(row, "ctv_taxonomy", "device_id", "deviceid"),
      useragent: pick(row, "useragent", "user_agent"),
    };
    label = [channel, genre, type].filter(Boolean).join(" · ") || "CTV impression";
  } else if (reportType === "apps") {
    const category = pick(row, "CategoryName", "category_name", "category");
    const taxonomy = pick(row, "TaxonomyName", "taxonomy_name", "taxonomy");
    const sig = pick(row, "Signals", "signals", "signal_count");
    if (category) tags.push({ code: `app.category.${slug(category)}`, label: `App category: ${category}`, parent_code: "app.category" });
    if (taxonomy) tags.push({ code: `app.taxonomy.${slug(taxonomy)}`, label: `App taxonomy: ${taxonomy}`, parent_code: "app.taxonomy" });
    const n = Number(sig);
    if (Number.isFinite(n) && n > 0) confidence = Math.min(1, 0.5 + Math.log10(1 + n) / 4);
    Object.assign(signals, { CategoryName: category, TaxonomyName: taxonomy, Signals: n || null });
    signals.meta = {
      bundle_id: pick(row, "bundle_id", "bundleid", "app_id"),
      platform: pick(row, "platform", "os"),
    };
    label = [category, taxonomy].filter(Boolean).join(" · ") || "App affinity";
  } else if (reportType === "visitation") {
    const brand = pick(row, "brandName", "brand_name", "brand");
    const ts = pick(row, "d_utc", "timestamp", "visit_time");
    const dp = daypart(ts);
    const distance = Number(pick(row, "distance", "dist_m"));
    if (brand) tags.push({ code: `visit.brand.${slug(brand)}`, label: `Visited brand: ${brand}`, parent_code: "visit.brand" });
    if (dp) tags.push({ code: `visit.daypart.${dp}`, label: `Visit daypart: ${dp}`, parent_code: "visit.daypart" });
    if (Number.isFinite(distance)) {
      // Closer to the POI centroid = higher confidence.
      confidence = distance <= 25 ? 0.9 : distance <= 100 ? 0.7 : distance <= 250 ? 0.5 : 0.35;
    }
    Object.assign(signals, { brandName: brand, visited_at: ts, daypart: dp, distance: Number.isFinite(distance) ? distance : null });
    signals.meta = { poi_id: pick(row, "poi_id", "poiid", "location_id") };
    label = [brand, dp].filter(Boolean).join(" · ") || "Visitation";
  } else if (reportType === "demographics") {
    const age = pick(row, "age_range", "agerange", "age_band", "age");
    const income = pick(row, "income_range", "income_band", "income");
    const household = pick(row, "household_composition", "household", "family_status", "marital_status");
    if (age) tags.push({ code: `demo.age.${slug(age)}`, label: `Age band: ${age}`, parent_code: "demo.age" });
    if (income) tags.push({ code: `demo.income.${slug(income)}`, label: `Income band: ${income}`, parent_code: "demo.income" });
    if (household) tags.push({ code: `demo.household.${slug(household)}`, label: `Household: ${household}`, parent_code: "demo.household" });
    Object.assign(signals, { age_band: age, income_band: income, household });
    signals.meta = { segment_codes: multi(pick(row, "segment_codes", "segments")) };
    label = [age, income].filter(Boolean).join(" · ") || "Demographics";
  } else {
    // origin
    const geoClass = pick(row, "origin_type", "location_type", "place_type", "type");
    const region = pick(row, "state", "region", "dma", "metro", "city");
    const travel = pick(row, "travel_type", "travel", "distance_band");
    if (geoClass) tags.push({ code: `origin.class.${slug(geoClass)}`, label: `Origin class: ${geoClass}`, parent_code: "origin.class" });
    if (region) tags.push({ code: `origin.region.${slug(region)}`, label: `Origin region: ${region}`, parent_code: "origin.region" });
    if (travel) tags.push({ code: `origin.travel.${slug(travel)}`, label: `Travel context: ${travel}`, parent_code: "origin.travel" });
    Object.assign(signals, { origin_class: geoClass, region, travel });
    signals.meta = { country: pick(row, "country"), provider: pick(row, "provider") };
    label = [region, geoClass].filter(Boolean).join(" · ") || "Origin";
  }

  if (!tags.length) return null;
  return { primary_identifier: id, report_type: reportType, tags, signals, confidence, label };
}

export function reportTypeFromKey(key: string): ReportType | null {
  const lower = key.toLowerCase();
  for (const t of REPORT_TYPES) {
    if (lower.startsWith(`${t}/`) || lower.includes(`/${t}/`) || lower.includes(`${t}_`)) return t;
  }
  return null;
}

export function partitionDateFromKey(key: string): string | null {
  const m = key.match(/dt=(\d{4}-\d{2}-\d{2})/) ?? key.match(/(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
}
