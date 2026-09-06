import { supabase } from "@/integrations/supabase/client";

/* ------------------------------------------------------------------ types */

export interface SummaryRow {
  CategoryName?: string | null;
  TaxonomyName?: string | null;
  uniques?: number | null;
  signals?: number | null;
  share?: number | null;
  period?: string | null;
  scope?: string | null;
  activation_id?: string | null;
}

export interface SignalBlock {
  rows?: SummaryRow[];
  confidence?: number | null;
  scores?: Record<string, number> | null;
  object_key?: string | null;
  scored_at?: string | null;
}

export interface TagRow {
  weight: number;
  taxonomy_nodes: { code: string; label: string; parent_code: string | null } | null;
}

export interface IngestFileRow {
  object_key: string;
  report_type: string;
  status: string;
  partition_date: string | null;
  size_bytes: number | null;
  total_rows: number;
  processed_rows: number;
  failed_rows: number;
  error_message: string | null;
  discovered_at: string;
  finished_at: string | null;
}

export interface RosterRow {
  primary_identifier: string;
  observation_count: number;
  last_seen_at: string | null;
  tag_codes: string[] | null;
}

export interface DrillData {
  file: IngestFileRow | null;
  rosterCount: number;
  roster: RosterRow[];
  matchedTags: TagRow[];
  matchedCodes: string[];
}

export const slugify = (v: string) =>
  v
    .toLowerCase()
    .replace(/&/g, " ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

export const fmtBytes = (n: number | null) => {
  if (n == null) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
};


export const SIGNAL_COLUMNS = [
  ["ctv_signals", "CTV"],
  ["apps_signals", "Apps"],
  ["visitation_signals", "Visitation"],
  ["demographics_signals", "Demographics"],
  ["origin_signals", "Origin"],
] as const;

export const SCORE_KEYS = [
  ["emotional_score", "Emotional"],
  ["cognitive_score", "Cognitive"],
  ["social_score", "Social"],
  ["communication_score", "Communication"],
  ["contextual_score", "Contextual"],
  ["artistic_score", "Artistic"],
] as const;

export const EVIDENCE_TIERS = [
  { factor: 1.0, kind: "librosa", detail: "full acoustic feature extraction" },
  { factor: 0.8, kind: "provider", detail: "provider metadata / preview audio" },
  { factor: 0.6, kind: "neighbors", detail: "nearest-neighbour profile inference" },
  { factor: 0.4, kind: "none", detail: "taxonomy metadata only — no audio was analysed" },
];


/* --------------------------------------------------------------- helpers */

export type DriverRow = SummaryRow & { feed: string; object_key?: string | null };

export const computeDriverRows = (identifier: Record<string, unknown> | null): DriverRow[] => {
  if (!identifier) return [];
  const out: DriverRow[] = [];
  for (const [col, label] of SIGNAL_COLUMNS) {
    const block = (identifier[col] ?? null) as SignalBlock | null;
    if (!block?.rows?.length) continue;
    for (const r of block.rows) out.push({ ...r, feed: label, object_key: block.object_key });
  }
  return out.sort((a, b) => (Number(b.uniques) || 0) - (Number(a.uniques) || 0));
};

export const computeMath = (analysis: Record<string, number | string | null> | null) => {
  if (!analysis) return null;
  const scores = SCORE_KEYS.map(([k]) => Number(analysis[k]) || 0);
  const mean = scores.reduce((s, v) => s + v, 0) / scores.length;
  const stddev = Math.sqrt(scores.reduce((s, v) => s + (v - mean) ** 2, 0) / scores.length);
  const spread = Math.max(0.1, Math.min(1, stddev / 30));
  const confidence = Number(analysis.confidence) || 0;
  const factor = spread > 0 ? confidence / spread : 0;
  const tier = EVIDENCE_TIERS.reduce(
    (best, t) => (Math.abs(t.factor - factor) < Math.abs(best.factor - factor) ? t : best),
    EVIDENCE_TIERS[0],
  );
  return { scores, mean, stddev, spread, confidence, factor, tier };
};

export interface Bundle {
  id: string;
  identifier: Record<string, unknown> | null;
  analysis: Record<string, number | string | null> | null;
  tags: TagRow[];
}

export const fetchBundle = async (id: string): Promise<{ bundle: Bundle | null; error?: string }> => {
  const { data, error } = await supabase
    .from("intuizi_identifiers")
    .select(
      "primary_identifier, ctv_signals, apps_signals, visitation_signals, demographics_signals, origin_signals, tag_codes, audio_source_id, observation_count, updated_at",
    )
    .eq("primary_identifier", `activation:${id.trim()}`)
    .maybeSingle();

  if (error) return { bundle: null, error: error.message };
  if (!data) return { bundle: null };

  const identifier = data as unknown as Record<string, unknown>;
  const sourceId = (data as { audio_source_id: string | null }).audio_source_id;
  if (!sourceId) return { bundle: { id, identifier, analysis: null, tags: [] } };

  const [anaRes, tagRes] = await Promise.all([
    supabase
      .from("source_analyses")
      .select(
        "confidence, category, created_at, emotional_score, cognitive_score, social_score, communication_score, contextual_score, artistic_score",
      )
      .eq("audio_source_id", sourceId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("audio_source_tags")
      .select("weight, taxonomy_nodes(code, label, parent_code)")
      .eq("audio_source_id", sourceId)
      .order("weight", { ascending: false }),
  ]);

  return {
    bundle: {
      id,
      identifier,
      analysis: (anaRes.data ?? null) as unknown as Record<string, number | string | null> | null,
      tags: (tagRes.data ?? []) as unknown as TagRow[],
    },
  };
};
