import {
  CheckCircle2,
  AlertTriangle,
  XCircle,
  CircleDashed,
} from "lucide-react";
import { type Status } from "@/lib/compatibilityReport";

export const STATUS_META: Record<Status, { label: string; icon: typeof CheckCircle2; className: string }> = {
  pass: { label: "Pass", icon: CheckCircle2, className: "bg-primary/15 text-primary border-primary/30" },
  warn: { label: "Mismatch", icon: AlertTriangle, className: "bg-amber-500/15 text-amber-500 border-amber-500/30" },
  fail: { label: "Blocking", icon: XCircle, className: "bg-destructive/15 text-destructive border-destructive/30" },
  skip: { label: "Not applicable", icon: CircleDashed, className: "bg-muted text-muted-foreground border-border" },
};
