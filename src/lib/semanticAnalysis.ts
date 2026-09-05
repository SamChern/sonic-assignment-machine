export type StepState = "ok" | "pending" | "error";

export interface IdentifierRow {
  id: string;
  primary_identifier: string;
  ctv_signals: Record<string, unknown> | null;
  apps_signals: Record<string, unknown> | null;
  visitation_signals: Record<string, unknown> | null;
  demographics_signals: Record<string, unknown> | null;
  origin_signals: Record<string, unknown> | null;
  tag_codes: string[] | null;
  audio_source_id: string | null;
  observation_count: number;
  last_seen_at: string | null;
  updated_at: string;
}

export interface SourceRow {
  id: string;
  name: string;
  analysis_status: string;
  analysis_error: string | null;
  profile_embedding: unknown | null;
}

export interface AnalysisRow {
  audio_source_id: string | null;
  category: string | null;
  confidence: number | null;
  created_at: string;
  emotional_score: number;
  cognitive_score: number;
  social_score: number;
  communication_score: number;
  contextual_score: number;
  artistic_score: number;
}

export interface SavedAnalysis extends AnalysisRow {
  id: string;
  source_name: string;
}

export const SAVED_PAGE_SIZE = 25;

export type SavedSort =
  | "newest"
  | "oldest"
  | "confidence_desc"
  | "confidence_asc"
  | "name_asc"
  | "name_desc";

export const SAVED_SORTS: Array<[SavedSort, string]> = [
  ["newest", "Newest first"],
  ["oldest", "Oldest first"],
  ["confidence_desc", "Highest confidence"],
  ["confidence_asc", "Lowest confidence"],
  ["name_asc", "Source A–Z"],
  ["name_desc", "Source Z–A"],
];

export const SORT_ORDER: Record<SavedSort, [string, boolean]> = {
  newest: ["created_at", false],
  oldest: ["created_at", true],
  confidence_desc: ["confidence", false],
  confidence_asc: ["confidence", true],
  name_asc: ["source_name", true],
  name_desc: ["source_name", false],
};

/** Quick date-range presets; null = all time. */
export const DATE_PRESETS: Array<[string, number | null]> = [
  ["All time", null],
  ["7d", 7],
  ["30d", 30],
  ["90d", 90],
];

export const CATEGORY_KEYS = [
  ["emotional_score", "Emo", "bg-category-emotional", "var(--gradient-emotional)"],
  ["cognitive_score", "Cog", "bg-category-cognitive", "var(--gradient-cognitive)"],
  ["social_score", "Soc", "bg-category-social", "var(--gradient-social)"],
  ["communication_score", "Com", "bg-category-communication", "var(--gradient-communication)"],
  ["contextual_score", "Ctx", "bg-category-contextual", "var(--gradient-contextual)"],
  ["artistic_score", "Art", "bg-category-artistic", "var(--gradient-artistic)"],
] as const;

export const CATEGORY_GRADIENTS: Record<string, string> = {
  emotional: "var(--gradient-emotional)",
  cognitive: "var(--gradient-cognitive)",
  social: "var(--gradient-social)",
  communication: "var(--gradient-communication)",
  contextual: "var(--gradient-contextual)",
  artistic: "var(--gradient-artistic)",
};

export const relative = (iso: string | null) => {
  if (!iso) return "never";
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 48) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
};

export const nonEmpty = (o: Record<string, unknown> | null | undefined) =>
  !!o && Object.keys(o).length > 0;

export type Stage = "all" | "normalized" | "linked" | "scored" | "failed";

/** Per-identifier pipeline status, shared by the filter and the row renderer. */
export function rowStatus(
  r: IdentifierRow,
  sources: Record<string, SourceRow>,
  analyses: Record<string, AnalysisRow>,
) {
  const signalGroups = [
    ["ctv", r.ctv_signals],
    ["apps", r.apps_signals],
    ["visitation", r.visitation_signals],
    ["demographics", r.demographics_signals],
    ["origin", r.origin_signals],
  ] as const;
  const present = signalGroups
    .filter(([, v]) => nonEmpty(v as Record<string, unknown>))
    .map(([k]) => k);
  const tags = r.tag_codes ?? [];
  const src = r.audio_source_id ? sources[r.audio_source_id] : undefined;
  const ana = r.audio_source_id ? analyses[r.audio_source_id] : undefined;

  const normState: StepState = present.length ? "ok" : "pending";
  const createState: StepState = !r.audio_source_id
    ? "pending"
    : src?.analysis_status === "failed"
      ? "error"
      : "ok";
  const scoreState: StepState = ana
    ? "ok"
    : src?.analysis_status === "failed"
      ? "error"
      : "pending";

  return { present, tags, src, ana, normState, createState, scoreState };
}
