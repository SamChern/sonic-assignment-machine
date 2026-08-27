// Intuizi report normalization: S3 prefix layout, file parsing (CSV / gzip CSV),
// and the field→tag mapping per report type.
//
// Only fields with ontological signal become taxonomy tags. Join keys and
// precise geo/device values are carried as metadata and never used as features.

import type { OntologyTag } from "./ontology.ts";
import { readParquetChunk, type ParquetCheckpoint } from "./parquet.ts";
export type { ParquetCheckpoint };


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
 * Fetch an object and decode a bounded chunk of rows.
 * Handles .csv, .csv.gz, .json(l) and .parquet (snappy/gzip/zstd/brotli).
 *
 * For Parquet, reads resume at `startRowGroup` and return a checkpoint so the
 * caller can persist progress and continue from the next unread row group.
 * Non-Parquet formats are read whole and report an exhausted checkpoint.
 */
export async function fetchObjectChunk(
  url: string,
  objectKey: string,
  maxRows = 5000,
  expectedRowsPerUser?: number,
  startRowGroup = 0,
  /** Wall-clock ms after which the read gives up and checkpoints instead. */
  deadlineAt?: number,
): Promise<{
  rows: Record<string, unknown>[];
  checkpoint: ParquetCheckpoint | null;
  deadlineExceeded?: boolean;
}> {
  const lower = objectKey.toLowerCase();

  if (lower.endsWith(".parquet") || lower.endsWith(".pq")) {
    return await readParquetChunk(url, maxRows, startRowGroup, expectedRowsPerUser, deadlineAt);
  }

  // Plain object reads are aborted at the deadline so a stalled transfer can
  // never hold the function open past the gateway's 150s idle limit.
  const signal = deadlineAt != null
    ? AbortSignal.timeout(Math.max(1_000, deadlineAt - Date.now()))
    : undefined;
  const res = await fetch(url, { signal });
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

  let rows: Record<string, unknown>[];
  if (lower.includes(".jsonl") || lower.includes(".ndjson")) {
    rows = text.split(/\r?\n/).filter((l) => l.trim()).map((l) => JSON.parse(l));
  } else if (lower.replace(/\.gz$/, "").endsWith(".json")) {
    const parsed = JSON.parse(text);
    rows = Array.isArray(parsed) ? parsed : (parsed.rows ?? []);
  } else {
    rows = parseCsv(text);
  }
  return { rows, checkpoint: null };
}

/** Backwards-compatible whole-object read (no checkpointing). */
export async function fetchObjectRows(
  url: string,
  objectKey: string,
  maxRows = 5000,
  expectedRowsPerUser?: number,
): Promise<Record<string, unknown>[]> {
  const { rows } = await fetchObjectChunk(url, objectKey, maxRows, expectedRowsPerUser, 0);
  return rows;
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

/** Stop-words that carry no topical meaning in a URL path. */
const PATH_STOP = new Set([
  "www", "index", "html", "htm", "php", "amp", "en", "en-us", "us", "news",
  "article", "articles", "story", "stories", "page", "pages", "p", "id",
]);

/**
 * Web-report `page` paths are the closest analogue to content topics
 * (`/lists/dolly-partons-most-...` → `lists`, `dolly-partons-most`). Keeps at
 * most two meaningful segments so a single URL cannot flood the taxonomy.
 */
export function pathTopics(page: string): string[] {
  if (!page) return [];
  const path = page.replace(/^https?:\/\/[^/]+/i, "").split(/[?#]/)[0];
  const out: string[] = [];
  for (const raw of path.split("/")) {
    const seg = raw.trim().toLowerCase();
    if (!seg || seg.length < 3 || /^\d+$/.test(seg) || PATH_STOP.has(seg)) continue;
    const trimmed = seg.replace(/\.(html?|php|aspx)$/, "").split("-").slice(0, 4).join("-");
    if (trimmed.length >= 3 && !out.includes(trimmed)) out.push(trimmed);
    if (out.length === 2) break;
  }
  return out;
}

/** Host portion of a referrer URL, without `www.`. */
export function hostOf(ref: string): string {
  if (!ref) return "";
  const m = ref.match(/^(?:https?:\/\/)?([^/?#\s]+)/i);
  return m ? m[1].replace(/^www\./i, "").toLowerCase() : "";
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
  return pick(
    row,
    "primary_identifier",
    "primaryidentifier",
    "eid",
    "maid",
    "madid",
    "maid_id",
    "idfa",
    "aaid",
    "gaid",
    "hem",
    "device_id",
    "email1",
    "hashed_email",
    "email",
  );
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
    // `domain` is the web-report analogue of a CTV channel.
    const channel = pick(row, "channelname", "channel_name", "network", "domain", "site");
    const iab = multi(pick(row, "iab_cats", "iab_categories", "iabcats", "iab_codes", "iabcodes"));
    if (genre) tags.push({ code: `ctv.genre.${slug(genre)}`, label: `CTV genre: ${genre}`, parent_code: "ctv.genre" });
    if (type) tags.push({ code: `ctv.type.${slug(type)}`, label: `CTV content type: ${type}`, parent_code: "ctv.type" });
    if (channel) tags.push({ code: `ctv.channel.${slug(channel)}`, label: `CTV channel: ${channel}`, parent_code: "ctv.channel" });
    for (const c of iab) tags.push({ code: `iab.${slug(c)}`, label: `IAB category ${c}`, parent_code: "iab" });

    // Web-report extras: page path tokens are the closest thing to content
    // topics, and the referrer host adds discovery context.
    const page = pick(row, "page", "path", "url");
    const topics = pathTopics(page);
    for (const t of topics) {
      tags.push({ code: `web.topic.${slug(t)}`, label: `Web topic: ${t}`, parent_code: "web.topic" });
    }
    const refHost = hostOf(pick(row, "ref", "referrer", "referer"));
    if (refHost) {
      tags.push({ code: `web.referrer.${slug(refHost)}`, label: `Referrer: ${refHost}`, parent_code: "web.referrer" });
    }

    // `signals` is visit intensity — weight confidence the same way apps do.
    const sigCount = Number(pick(row, "signals", "signal_count", "impressions"));
    if (Number.isFinite(sigCount) && sigCount > 0) {
      confidence = Math.min(1, 0.5 + Math.log10(1 + sigCount) / 4);
    }

    Object.assign(signals, {
      contentgenre: genre,
      contenttype: type,
      channelname: channel,
      iab_cats: iab,
      web_topics: topics,
      referrer_host: refHost || null,
      signals: Number.isFinite(sigCount) ? sigCount : null,
    });

    // metadata only
    signals.meta = {
      device_id: pick(row, "ctv_taxonomy", "device_id", "deviceid"),
      useragent: pick(row, "useragent", "user_agent"),
      page,
    };
    label = [channel, genre, type, topics[0]].filter(Boolean).join(" · ") || "CTV impression";

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

/* ------------------------------------------- activation-level (summary) rows */

/** `..._activation_id5498_uniquedevices.csv` -> `5498`. */
export function activationIdFromKey(key: string): string | null {
  return key.toLowerCase().match(/activation[_-]?id(\d+)/)?.[1] ?? null;
}

/**
 * True when a row carries taxonomy content but no per-device identifier — the
 * Intuizi "summary report" shape (audience-level rollup per taxonomy category).
 */
export function isSummaryRow(row: Record<string, unknown>): boolean {
  if (identifierOf(row)) return false;
  return !!(
    pick(row, "taxonomyname", "taxonomy_name", "taxonomy") ||
    pick(row, "categoryname", "category_name", "category")
  );
}

/** True when a row has only join keys (device ids / emails) and no taxonomy content. */
export function isRosterRow(row: Record<string, unknown>): boolean {
  if (!identifierOf(row)) return false;
  return !(
    pick(row, "taxonomyname", "taxonomy_name", "taxonomy") ||
    pick(row, "categoryname", "category_name", "category") ||
    pick(row, "contentgenre", "content_genre", "genre", "channelname", "iab_cats")
  );
}


/**
 * Fold an audience-level summary report into one synthetic "audience profile"
 * row so it can travel the same ontology path as a music source. Tag weights
 * follow each category's share of unique devices.
 */
export function normalizeSummaryRows(
  reportType: ReportType,
  rows: Record<string, unknown>[],
  objectKey: string,
): NormalizedRow[] {
  const activation = activationIdFromKey(objectKey) ?? "unknown";
  const identifier = `activation:${activation}`;
  const totals = rows.map((r) => Number(pick(r, "uniques", "unique_devices", "devices")) || 0);
  const total = totals.reduce((a, b) => a + b, 0) || rows.length || 1;

  const out: NormalizedRow[] = [];
  rows.forEach((row, i) => {
    const category = pick(row, "categoryname", "category_name", "category");
    const taxonomy = pick(row, "taxonomyname", "taxonomy_name", "taxonomy");
    if (!category && !taxonomy) return;
    const share = (totals[i] || 1) / total;
    const tags: OntologyTag[] = [];
    if (category) {
      tags.push({
        code: `app.category.${slug(category)}`,
        label: `App category: ${category}`,
        parent_code: "app.category",
      });
    }
    if (taxonomy) {
      tags.push({
        code: `app.taxonomy.${slug(taxonomy)}`,
        label: `App taxonomy: ${taxonomy}`,
        parent_code: "app.taxonomy",
      });
    }
    out.push({
      primary_identifier: identifier,
      report_type: reportType,
      tags,
      signals: {
        scope: "audience_summary",
        activation_id: activation,
        CategoryName: category,
        TaxonomyName: taxonomy,
        uniques: totals[i] || null,
        share: Number(share.toFixed(4)),
        signals: Number(pick(row, "signals", "signal_count")) || null,
        period: [pick(row, "year"), pick(row, "month")].filter(Boolean).join("-") || null,
      },
      confidence: Math.min(1, 0.5 + 0.5 * share),
      label: [taxonomy, category].filter(Boolean).join(" · ") || `Activation ${activation}`,
    });
  });
  return out;
}

/* ------------------------------------------------------- prefixes & routing */


/**
 * S3 prefixes the scheduled ingest scans.
 *
 * `report_type: null` means the prefix is mixed-content (Intuizi activation
 * exports land there with the report kind encoded in the filename), so the type
 * is resolved per object with `reportTypeFromKey`.
 */
export const INGEST_PREFIXES: { prefix: string; report_type: ReportType | null }[] = [
  ...REPORT_TYPES.map((t) => ({ prefix: `${t}/`, report_type: t })),
  { prefix: "Activations/", report_type: null },
  // Intuizi console delivery prefixes (report kind encoded in the filename).
  { prefix: "marketing_audience/", report_type: null },
  { prefix: "marketing_audience_maids_and_hems/", report_type: null },
  { prefix: "apps_summary_report/", report_type: null },
];

/** Audio file extensions ingested as real audio (scored via librosa + ontology). */
const AUDIO_EXTENSIONS = [
  ".mp3", ".wav", ".m4a", ".aac", ".flac", ".ogg", ".oga", ".opus", ".wma", ".aiff", ".aif",
];

/** True when an object key points at an audio file rather than a report. */
export function isAudioKey(key: string): boolean {
  const lower = key.toLowerCase();
  return AUDIO_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

/**
 * Prefixes to scan for a run.
 *
 * Extends the static layout above with:
 *  - `INTUIZI_S3_PREFIXES` — comma-separated extra prefixes (e.g. a delivery
 *    folder such as `845ad58c44eee47b75af72c9667bda04/`).
 *  - a bucket-root scan (`""`) unless `INTUIZI_S3_SCAN_ROOT=false`, so audio
 *    files and deliveries dropped in any new folder are still discovered.
 */
export function ingestPrefixes(): { prefix: string; report_type: ReportType | null }[] {
  const out = [...INGEST_PREFIXES];
  const extra = (Deno.env.get("INTUIZI_S3_PREFIXES") ?? "")
    .split(",").map((s) => s.trim()).filter(Boolean);
  for (const p of extra) {
    const prefix = p.endsWith("/") || p === "" ? p : `${p}/`;
    if (!out.some((e) => e.prefix === prefix)) out.push({ prefix, report_type: null });
  }
  const scanRoot = (Deno.env.get("INTUIZI_S3_SCAN_ROOT") ?? "true").toLowerCase() !== "false";
  if (scanRoot && !out.some((e) => e.prefix === "")) out.push({ prefix: "", report_type: null });
  return out;
}




/** Filename tokens that identify a report type in activation exports. */
const TYPE_TOKENS: { type: ReportType; tokens: string[] }[] = [
  // Web reports carry IAB codes + domains — the same content-affinity shape the
  // ctv mapping already handles, so they resolve to `ctv`.
  {
    type: "ctv",
    tokens: [
      "ctv", "connectedtv", "connected-tv", "streaming", "soundtracksignals",
      "web", "webreport", "iab", "domains",
    ],
  },
  { type: "apps", tokens: ["apps", "app", "appaffinity", "mobileapp", "appusage"] },
  { type: "visitation", tokens: ["visitation", "visits", "visit", "footfall", "poi"] },
  {
    // Marketing-audience deliveries are identifier rosters; they fall through to
    // the roster path when no taxonomy columns are present.
    type: "demographics",
    tokens: [
      "demographics", "demographic", "demos", "audienceprofile",
      "audience", "marketingaudience", "maids", "hems", "uniquedevices",
    ],
  },
  { type: "origin", tokens: ["origin", "origins", "homeorigin", "geoorigin", "travel"] },
];


/**
 * Resolve the report type for an object key.
 * Directory prefixes win; otherwise the filename is tokenized (Intuizi activation
 * names such as `..._ctv_-_sonicsim_activation_id5493_uniquedevices.parquet`).
 */
export function reportTypeFromKey(key: string): ReportType | null {
  const lower = key.toLowerCase();

  for (const t of REPORT_TYPES) {
    if (lower.startsWith(`${t}/`) || lower.includes(`/${t}/`)) return t;
  }

  const name = lower.split("/").pop() ?? lower;
  const parts = name.replace(/\.[a-z0-9]+$/, "").split(/[^a-z0-9]+/).filter(Boolean);
  for (const { type, tokens } of TYPE_TOKENS) {
    if (parts.some((p) => tokens.includes(p))) return type;
  }
  // Compact names without separators (e.g. `ctvsignals20260821`).
  const squashed = parts.join("");
  for (const { type, tokens } of TYPE_TOKENS) {
    if (tokens.some((tok) => tok.length > 3 && squashed.includes(tok))) return type;
  }
  return null;
}


export function partitionDateFromKey(key: string): string | null {
  const m = key.match(/dt=(\d{4}-\d{2}-\d{2})/) ?? key.match(/(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
}
