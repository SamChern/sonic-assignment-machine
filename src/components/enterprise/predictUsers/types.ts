import { CATEGORY_KEYS, type CategoryKey } from "@/lib/enterpriseSchema";

export interface RecordRow {
  id: string;
  external_user_id: string | null;
  source_name: string | null;
  dataset_id: string;
  emotional_score: number | null;
  cognitive_score: number | null;
  social_score: number | null;
  communication_score: number | null;
  contextual_score: number | null;
  artistic_score: number | null;
}

export interface DatasetOption {
  id: string;
  name: string;
}

export type Weights = Record<CategoryKey, number>;

export interface SeedTag {
  id: string;
  code: string;
  label: string;
  similarity: number;
}

export interface KnnMatch {
  key: string;
  label: string;
  knn_similarity: number;
  axis_fit: number;
  score: number;
  scores: Record<CategoryKey, number>;
}

export interface CurvePoint {
  threshold: number;
  matched: number;
  low: number;
  high: number;
  mean_similarity: number;
}

export const DEFAULT_WEIGHTS: Weights = {
  emotional: 1,
  cognitive: 1,
  social: 1,
  communication: 1,
  contextual: 1,
  artistic: 1,
};

export const recordScores = (r: RecordRow) =>
  Object.fromEntries(
    CATEGORY_KEYS.map((c) => [
      c,
      Number((r as unknown as Record<string, number | null>)[`${c}_score`] ?? 0),
    ]),
  ) as Record<CategoryKey, number>;
