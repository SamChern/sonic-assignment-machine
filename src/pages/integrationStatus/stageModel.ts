/**
 * Shared shapes and formatting helpers for the Intuizi Console stage view.
 *
 * Kept beside the page so the page file stays about rendering, and so the
 * staleness/relative-time rules can be unit tested on their own.
 */
import {
  AlertTriangle,
  CheckCircle2,
  CircleDashed,
  XCircle,
} from "lucide-react";

export type Health = "ok" | "warn" | "error" | "idle";

export interface DetailRow {
  id: string;
  title: string;
  timestamp: string | null;
  status?: string;
  meta?: string;
  error?: string | null;
}

export interface Stage {
  key: string;
  title: string;
  subtitle: string;
  health: Health;
  lastRunAt: string | null;
  metrics: { label: string; value: string }[];
  note?: string;
  detailsLabel: string;
  details: DetailRow[];
}

export const HEALTH_META: Record<
  Health,
  { label: string; icon: typeof CheckCircle2; className: string }
> = {
  ok: {
    label: "Healthy",
    icon: CheckCircle2,
    className: "bg-primary/15 text-primary border-primary/30",
  },
  warn: {
    label: "Degraded",
    icon: AlertTriangle,
    className: "bg-amber-500/15 text-amber-500 border-amber-500/30",
  },
  error: {
    label: "Failing",
    icon: XCircle,
    className: "bg-destructive/15 text-destructive border-destructive/30",
  },
  idle: {
    label: "No data yet",
    icon: CircleDashed,
    className: "bg-muted text-muted-foreground border-border",
  },
};

/** Human-readable "how long ago", coarse on purpose. */
export const relative = (iso: string | null) => {
  if (!iso) return "never";
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.round(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 48) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
};

/** A stage with no runs is idle, not broken; old runs read as degraded. */
export const staleness = (iso: string | null, warnHours: number): Health => {
  if (!iso) return "idle";
  const hrs = (Date.now() - new Date(iso).getTime()) / 3600000;
  return hrs > warnHours ? "warn" : "ok";
};
