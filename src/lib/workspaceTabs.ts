/**
 * Workspace navigation model — the loop the product runs: bring data in,
 * understand it, predict from it, activate on it. Kept out of the page so both
 * the workspace and the per-account portal can reason about the same tabs.
 */
import {
  Activity,
  BookMarked,
  Compass,
  Layers,
  LineChart,
  Sliders,
  Sparkles,
  Tag,
  Target,
  Upload,
} from "lucide-react";
import type { CapabilityKey, Capabilities } from "@/lib/orgCapabilities";

export const GROUPS = [
  {
    key: "data",
    label: "Data",
    icon: Upload,
    tabs: [
      { key: "data", label: "My data", icon: Upload },
      { key: "enrich", label: "Enrichment", icon: Layers, needs: "enrichment_preview" },
      { key: "discover", label: "Discovery", icon: Compass, needs: "semantic_model" },
    ],
  },
  {
    key: "understand",
    label: "Understand",
    icon: Sparkles,
    tabs: [
      { key: "analyses", label: "Analyses", icon: Sparkles },
      { key: "sonicsim", label: "See my SonicSIM", icon: Activity, needs: "semantic_model" },
      { key: "categories", label: "Categories", icon: Sliders, needs: "semantic_model" },
    ],
  },
  {
    key: "predict",
    label: "Predict",
    icon: Target,
    tabs: [
      { key: "users", label: "Predict users", icon: Target, needs: "predict_users" },
      { key: "outcomes", label: "Predict outcomes", icon: LineChart, needs: "predict_outcomes" },
      { key: "playbooks", label: "Playbooks", icon: BookMarked, needs: "predict_users" },
    ],
  },
  {
    key: "activate",
    label: "Activate",
    icon: Tag,
    tabs: [{ key: "tags", label: "Tracking & pixels", icon: Tag, needs: "pixels_tracking" }],
  },
] as const satisfies readonly {
  key: string;
  label: string;
  icon: typeof Upload;
  tabs: readonly { key: string; label: string; icon: typeof Upload; needs?: CapabilityKey }[];
}[];

export type GroupKey = (typeof GROUPS)[number]["key"];

export const ALL_TABS = GROUPS.flatMap((g) => g.tabs.map((t) => ({ ...t, group: g.key })));

export const groupOf = (tabKey: string): GroupKey =>
  (ALL_TABS.find((t) => t.key === tabKey)?.group ?? "understand") as GroupKey;

/** Only the tabs this account's access switches allow, groups with none dropped. */
export const permittedGroups = (caps: Capabilities) =>
  GROUPS.map((g) => ({
    ...g,
    tabs: g.tabs.filter((t) => !("needs" in t) || !t.needs || caps[t.needs]),
  })).filter((g) => g.tabs.length > 0);
