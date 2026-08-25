import { CATEGORY_KEYS, type CategoryKey } from "@/lib/enterpriseSchema";

/**
 * Per-organization customization of the 6 SonicSIM semantic categories.
 * A profile never changes stored scores — it is a mapping layer applied at
 * read time (rename, re-weight, shift, or mute a category), versioned so an
 * organization can iterate without losing an earlier calibration.
 */
export interface CategorySetting {
  /** Organization-facing name for the category. */
  label: string;
  /** How much the category counts in matching (0 = ignored, 3 = triple). */
  weight: number;
  /** Calibration shift applied to incoming scores, in score points. */
  bias: number;
  /** When false the category is excluded from mapping and matching. */
  enabled: boolean;
}

export type CategoryProfileConfig = Record<CategoryKey, CategorySetting>;

export interface CategoryProfile {
  id: string;
  organization_id: string;
  version: number;
  name: string;
  notes: string | null;
  config: CategoryProfileConfig;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export const DEFAULT_CATEGORY_LABELS: Record<CategoryKey, string> = {
  emotional: "Emotional",
  cognitive: "Cognitive",
  social: "Social",
  communication: "Communication",
  contextual: "Contextual",
  artistic: "Artistic",
};

export const defaultCategoryProfileConfig = (): CategoryProfileConfig =>
  Object.fromEntries(
    CATEGORY_KEYS.map((c) => [
      c,
      { label: DEFAULT_CATEGORY_LABELS[c], weight: 1, bias: 0, enabled: true },
    ]),
  ) as CategoryProfileConfig;

const clampNumber = (v: unknown, min: number, max: number, fallback: number) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
};

/** Tolerant parse of a stored jsonb config so partial/legacy rows still load. */
export const parseCategoryProfileConfig = (raw: unknown): CategoryProfileConfig => {
  const base = defaultCategoryProfileConfig();
  if (!raw || typeof raw !== "object") return base;
  const source = raw as Record<string, unknown>;
  for (const c of CATEGORY_KEYS) {
    const entry = source[c];
    if (!entry || typeof entry !== "object") continue;
    const e = entry as Record<string, unknown>;
    base[c] = {
      label: typeof e.label === "string" && e.label.trim() ? e.label.trim() : base[c].label,
      weight: clampNumber(e.weight, 0, 3, base[c].weight),
      bias: clampNumber(e.bias, -25, 25, base[c].bias),
      enabled: e.enabled === undefined ? base[c].enabled : e.enabled !== false,
    };
  }
  return base;
};

export const categoryLabel = (config: CategoryProfileConfig, c: CategoryKey) =>
  config[c].label || DEFAULT_CATEGORY_LABELS[c];

export const activeCategories = (config: CategoryProfileConfig) =>
  CATEGORY_KEYS.filter((c) => config[c].enabled);

/** Score after the profile's calibration shift, clamped to the 0-100 scale. */
export const mapScore = (config: CategoryProfileConfig, c: CategoryKey, raw: number) =>
  Math.min(100, Math.max(0, raw + config[c].bias));

export interface MappedCategory {
  key: CategoryKey;
  label: string;
  raw: number;
  mapped: number;
  delta: number;
  weight: number;
  /** Share of total matching influence, 0-1. */
  influence: number;
  enabled: boolean;
}

/** Full input → category mapping used by the editor preview and by matching. */
export const mapProfileInput = (
  config: CategoryProfileConfig,
  raw: Partial<Record<CategoryKey, number>>,
): MappedCategory[] => {
  const totalWeight =
    CATEGORY_KEYS.reduce((s, c) => s + (config[c].enabled ? config[c].weight : 0), 0) || 1;
  return CATEGORY_KEYS.map((c) => {
    const rawScore = Number(raw[c] ?? 0);
    const mapped = config[c].enabled ? mapScore(config, c, rawScore) : 0;
    return {
      key: c,
      label: categoryLabel(config, c),
      raw: rawScore,
      mapped,
      delta: config[c].enabled ? mapped - rawScore : 0,
      weight: config[c].weight,
      influence: config[c].enabled ? config[c].weight / totalWeight : 0,
      enabled: config[c].enabled,
    };
  });
};

/**
 * Weighted closeness between a target profile and a record, honoring per-category
 * weights and skipping disabled categories entirely.
 */
export const profileSimilarity = (
  config: CategoryProfileConfig,
  target: Record<CategoryKey, number>,
  record: Partial<Record<CategoryKey, number>>,
) => {
  const cats = activeCategories(config);
  if (!cats.length) return 0;
  const totalW = cats.reduce((s, c) => s + config[c].weight, 0);
  if (totalW <= 0) return 0;
  const diff =
    cats.reduce((s, c) => {
      const t = mapScore(config, c, Number(target[c] ?? 0));
      const v = mapScore(config, c, Number(record[c] ?? 0));
      return s + config[c].weight * Math.abs(t - v);
    }, 0) / totalW;
  return Math.max(0, 100 - diff);
};

export interface CategoryDiffRow {
  key: CategoryKey;
  labelChanged: boolean;
  weightChanged: boolean;
  biasChanged: boolean;
  enabledChanged: boolean;
  changed: boolean;
  left: CategorySetting;
  right: CategorySetting;
  /** Match-influence share in each version, 0-1, so re-weighting is visible. */
  leftInfluence: number;
  rightInfluence: number;
}

const influenceMap = (config: CategoryProfileConfig) => {
  const total =
    CATEGORY_KEYS.reduce((s, c) => s + (config[c].enabled ? config[c].weight : 0), 0) || 1;
  return (c: CategoryKey) => (config[c].enabled ? config[c].weight / total : 0);
};

/** Per-category comparison of two calibration versions (left = older/base). */
export const diffCategoryProfiles = (
  left: CategoryProfileConfig,
  right: CategoryProfileConfig,
): CategoryDiffRow[] => {
  const li = influenceMap(left);
  const ri = influenceMap(right);
  return CATEGORY_KEYS.map((c) => {
    const labelChanged = left[c].label !== right[c].label;
    const weightChanged = Math.abs(left[c].weight - right[c].weight) > 0.001;
    const biasChanged = Math.abs(left[c].bias - right[c].bias) > 0.001;
    const enabledChanged = left[c].enabled !== right[c].enabled;
    return {
      key: c,
      labelChanged,
      weightChanged,
      biasChanged,
      enabledChanged,
      changed: labelChanged || weightChanged || biasChanged || enabledChanged,
      left: left[c],
      right: right[c],
      leftInfluence: li(c),
      rightInfluence: ri(c),
    };
  });
};

export interface MultiVersionCell {
  setting: CategorySetting;
  /** Match-influence share within its own version, 0-1. */
  influence: number;
  /** True when this cell differs from the cell immediately to its left. */
  changedFromPrev: boolean;
  labelChanged: boolean;
  weightChanged: boolean;
  biasChanged: boolean;
  enabledChanged: boolean;
}

export interface MultiVersionRow {
  key: CategoryKey;
  cells: MultiVersionCell[];
  /** Number of transitions where this category changed. */
  changeCount: number;
  /** True when the category differs anywhere across the compared versions. */
  changed: boolean;
}

/**
 * Compare 2+ calibration versions at once. Each cell is flagged against the
 * version immediately before it, so a row reads as a change timeline.
 */
export const compareCategoryProfiles = (
  configs: CategoryProfileConfig[],
): MultiVersionRow[] => {
  const influences = configs.map((c) => influenceMap(c));
  return CATEGORY_KEYS.map((c) => {
    let changeCount = 0;
    const cells: MultiVersionCell[] = configs.map((config, i) => {
      const prev = i > 0 ? configs[i - 1][c] : null;
      const cur = config[c];
      const labelChanged = !!prev && prev.label !== cur.label;
      const weightChanged = !!prev && Math.abs(prev.weight - cur.weight) > 0.001;
      const biasChanged = !!prev && Math.abs(prev.bias - cur.bias) > 0.001;
      const enabledChanged = !!prev && prev.enabled !== cur.enabled;
      const changedFromPrev = labelChanged || weightChanged || biasChanged || enabledChanged;
      if (changedFromPrev) changeCount += 1;
      return {
        setting: cur,
        influence: influences[i](c),
        changedFromPrev,
        labelChanged,
        weightChanged,
        biasChanged,
        enabledChanged,
      };
    });
    return { key: c, cells, changeCount, changed: changeCount > 0 };
  });
};
