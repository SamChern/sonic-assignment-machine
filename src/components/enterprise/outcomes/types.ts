export const CATEGORIES = [
  "emotional",
  "cognitive",
  "social",
  "communication",
  "contextual",
  "artistic",
] as const;

export type CategoryName = (typeof CATEGORIES)[number];

export interface Driver {
  category: string;
  coefficient: number;
  per_10_points: number;
  per_10_ci: [number, number];
  ci_low: number;
  ci_high: number;
  /** True when the bootstrap interval crosses zero: not yet distinguishable. */
  inconclusive: boolean;
}

export interface LiftPrior {
  category: string;
  lift: number;
  ci_low: number;
  ci_high: number;
  exposed_n: number;
  holdout_n: number;
  cohort_slug: string;
}

export interface OutcomeResult {
  kpi: string;
  kpi_source: string;
  matched_rows: number;
  min_rows: number;
  engine: string;
  bootstrap_iters: number;
  intercept: number;
  r2: number;
  mean_actual: number;
  mean_scores: Record<string, number>;
  conclusive_count: number;
  lift_priors: LiftPrior[];
  drivers: Driver[];
  top_predicted: { record_id: string; label: string; predicted: number; actual: number | null }[];
}

export interface LiftReport {
  exposed_events: number;
  holdout_events: number;
  exposed_mean: number;
  holdout_mean: number;
  absolute_lift: number;
  relative_lift: number | null;
  measurable: boolean;
  priors_written: number;
  note?: string;
}

export interface DatasetOption {
  id: string;
  name: string;
}

export interface Counterfactual {
  predicted: number;
  delta: number;
  ciLow: number;
  ciHigh: number;
  conclusive: boolean;
}
