export type BrowseKind = "projects" | "audiences" | "activations" | "cohorts";

export const BROWSE_TOOL: Record<BrowseKind, string> = {
  projects: "list_projects",
  audiences: "list_audiences",
  activations: "list_activations",
  cohorts: "list_cohorts",
};

export interface PendingWrite {
  tool: string;
  args: Record<string, unknown>;
  label: string;
  destructive: boolean;
  onDone?: (resourceId: string | null, result: unknown) => void;
}
