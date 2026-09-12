/**
 * Per-account access switches for enterprise workspaces.
 *
 * Platform admins set these from Admin -> Enterprise accounts. Everything
 * defaults to on, so an account with no row behaves exactly as before.
 */
export const CAPABILITY_KEYS = [
  "intuizi_console",
  "semantic_model",
  "clap_grounding",
  "eid_enrichment",
  "pixels_tracking",
  "predict_users",
  "predict_outcomes",
  "enrichment_preview",
] as const;

export type CapabilityKey = (typeof CAPABILITY_KEYS)[number];

export type Capabilities = Record<CapabilityKey, boolean>;

export const ALL_CAPABILITIES: Capabilities = CAPABILITY_KEYS.reduce(
  (acc, key) => ({ ...acc, [key]: true }),
  {} as Capabilities,
);

export const CAPABILITY_LABELS: Record<CapabilityKey, { label: string; hint: string }> = {
  intuizi_console: {
    label: "Intuizi console and data feed",
    hint: "Sync granted activation feeds into the workspace.",
  },
  semantic_model: {
    label: "Semantic model (six categories)",
    hint: "Full six-category scoring, discovery and category editing.",
  },
  clap_grounding: {
    label: "CLAP audio grounding",
    hint: "Ground scores in the audio itself, not just text signals.",
  },
  eid_enrichment: {
    label: "Device-level enrichment and append",
    hint: "Append SonicSIM scores back onto feed rows at the device level.",
  },
  pixels_tracking: {
    label: "Site pixels and tracking",
    hint: "Their own tag, conversion events and KPI capture.",
  },
  predict_users: {
    label: "Predict users",
    hint: "Look-alike audiences and playbooks.",
  },
  predict_outcomes: {
    label: "Predict outcomes",
    hint: "Relate the six scores to their KPIs.",
  },
  enrichment_preview: {
    label: "Enrichment preview",
    hint: "Read-only view of what SonicSIM adds to each feed and which KPIs it moves.",
  },
};

/** Coerce a database row (or nothing) into a complete switch set. */
export function toCapabilities(row: Record<string, unknown> | null | undefined): Capabilities {
  if (!row) return { ...ALL_CAPABILITIES };
  return CAPABILITY_KEYS.reduce((acc, key) => {
    acc[key] = row[key] === undefined || row[key] === null ? true : Boolean(row[key]);
    return acc;
  }, {} as Capabilities);
}
