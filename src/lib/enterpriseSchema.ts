/**
 * Enterprise CSV contract + parsing helpers.
 *
 * The workspace publishes this schema to the customer, parses their file in the
 * browser for preview, then posts normalized rows to `enterprise-ingest-csv`
 * which re-validates everything server-side.
 */

export const CATEGORY_KEYS = [
  "emotional",
  "cognitive",
  "social",
  "communication",
  "contextual",
  "artistic",
] as const;

export type CategoryKey = (typeof CATEGORY_KEYS)[number];

export const KPI_OPTIONS = [
  { key: "site_traffic", label: "Site traffic (sessions)" },
  { key: "cpc", label: "CPC (cost per click)" },
  { key: "ctr", label: "CTR (click-through rate)" },
  { key: "page_views", label: "Page views" },
  { key: "vcr", label: "VCR (video completion rate)" },
  { key: "time_on_site", label: "Time spent on site (seconds)" },
] as const;

export type KpiKey = (typeof KPI_OPTIONS)[number]["key"];

export interface SchemaColumn {
  name: string;
  required: boolean;
  description: string;
}

export const CSV_COLUMNS: SchemaColumn[] = [
  {
    name: "external_user_id",
    required: false,
    description:
      "Your own stable ID for the person or device. Required to join uploaded rows to tag-captured KPI events.",
  },
  {
    name: "source_name",
    required: true,
    description:
      "Track, episode, spot or stream name. SonicSIM matches this against analyzed audio to attach semantic scores.",
  },
  {
    name: "audio_url",
    required: false,
    description: "Public link to the audio file, when the source has not been analyzed yet.",
  },
  ...CATEGORY_KEYS.map((c) => ({
    name: `${c}_score`,
    required: false,
    description: `Optional pre-scored ${c} value, 0-100. Leave blank to let SonicSIM score it.`,
  })),
  ...KPI_OPTIONS.map((k) => ({
    name: `kpi_${k.key}`,
    required: false,
    description: `Observed ${k.label}. Used by Predict SonicSIM-Outcomes.`,
  })),
  {
    name: "attr_*",
    required: false,
    description:
      "Any extra column prefixed with attr_ (e.g. attr_market, attr_segment) is kept as a filterable attribute.",
  },
];

export const SAMPLE_CSV = [
  "external_user_id,source_name,emotional_score,kpi_ctr,attr_market",
  "u_10021,Midnight City,72,0.031,US-NY",
  "u_10022,Weekly Roundup Ep. 41,,0.018,US-CA",
  "u_10023,Brand Spot 15s,64,0.042,UK-LDN",
].join("\n");

/** Minimal RFC4180-style CSV parser (handles quotes, escaped quotes, CRLF). */
export function parseCsv(input: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (quoted) {
      if (ch === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') {
      quoted = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (ch !== "\r") {
      field += ch;
    }
  }
  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

export interface NormalizedRow {
  external_user_id: string | null;
  source_name: string | null;
  audio_url: string | null;
  attributes: Record<string, string>;
  kpi: Record<string, number>;
  scores: Partial<Record<CategoryKey, number>>;
}

export interface ParseReport {
  headers: string[];
  rows: NormalizedRow[];
  unknownColumns: string[];
  missingRequired: string[];
  rowsWithoutSource: number;
  scoredRows: number;
  kpiColumns: string[];
}

const numeric = (v: string): number | null => {
  const t = v.trim();
  if (!t) return null;
  const n = Number(t.replace(/[%$,]/g, ""));
  return Number.isFinite(n) ? n : null;
};

export function normalizeCsv(text: string): ParseReport {
  const table = parseCsv(text);
  if (!table.length) {
    return {
      headers: [],
      rows: [],
      unknownColumns: [],
      missingRequired: ["source_name"],
      rowsWithoutSource: 0,
      scoredRows: 0,
      kpiColumns: [],
    };
  }

  const headers = table[0].map((h) => h.trim().toLowerCase().replace(/\s+/g, "_"));
  const known = new Set<string>([
    "external_user_id",
    "source_name",
    "audio_url",
    ...CATEGORY_KEYS.map((c) => `${c}_score`),
    ...KPI_OPTIONS.map((k) => `kpi_${k.key}`),
  ]);
  const unknownColumns = headers.filter((h) => !known.has(h) && !h.startsWith("attr_"));
  const kpiColumns = headers.filter((h) => h.startsWith("kpi_"));

  const rows: NormalizedRow[] = [];
  let rowsWithoutSource = 0;
  let scoredRows = 0;

  for (const raw of table.slice(1)) {
    const get = (name: string) => {
      const idx = headers.indexOf(name);
      return idx >= 0 ? (raw[idx] ?? "").trim() : "";
    };

    const attributes: Record<string, string> = {};
    headers.forEach((h, i) => {
      if (h.startsWith("attr_")) {
        const v = (raw[i] ?? "").trim();
        if (v) attributes[h.slice(5)] = v;
      }
    });

    const kpi: Record<string, number> = {};
    for (const k of KPI_OPTIONS) {
      const v = numeric(get(`kpi_${k.key}`));
      if (v !== null) kpi[k.key] = v;
    }

    const scores: Partial<Record<CategoryKey, number>> = {};
    for (const c of CATEGORY_KEYS) {
      const v = numeric(get(`${c}_score`));
      if (v !== null) scores[c] = Math.max(0, Math.min(100, v));
    }
    if (CATEGORY_KEYS.every((c) => scores[c] !== undefined)) scoredRows += 1;

    const sourceName = get("source_name") || null;
    if (!sourceName) rowsWithoutSource += 1;

    rows.push({
      external_user_id: get("external_user_id") || null,
      source_name: sourceName,
      audio_url: get("audio_url") || null,
      attributes,
      kpi,
      scores,
    });
  }

  return {
    headers,
    rows,
    unknownColumns,
    missingRequired: headers.includes("source_name") ? [] : ["source_name"],
    rowsWithoutSource,
    scoredRows,
    kpiColumns,
  };
}
