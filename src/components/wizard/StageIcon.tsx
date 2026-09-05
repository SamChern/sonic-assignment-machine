import { AlertTriangle, CheckCircle2, CircleDashed, Loader2 } from "lucide-react";
import type { StageState } from "@/lib/wizard/types";

const StageIcon = ({ state }: { state: StageState }) => {
  if (state === "running") return <Loader2 className="h-4 w-4 animate-spin text-primary" />;
  if (state === "ok") return <CheckCircle2 className="h-4 w-4 text-primary" />;
  if (state === "warn") return <AlertTriangle className="h-4 w-4 text-amber-500" />;
  if (state === "error") return <AlertTriangle className="h-4 w-4 text-destructive" />;
  return <CircleDashed className="h-4 w-4 text-muted-foreground" />;
};

export default StageIcon;
