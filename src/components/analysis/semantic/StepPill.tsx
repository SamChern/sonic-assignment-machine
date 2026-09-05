import { CheckCircle2, AlertTriangle, CircleDashed } from "lucide-react";
import { StepState } from "@/lib/semanticAnalysis";

export const StepPill = ({
  label,
  state,
  detail,
}: {
  label: string;
  state: StepState;
  detail: string;
}) => {
  const Icon =
    state === "ok" ? CheckCircle2 : state === "error" ? AlertTriangle : CircleDashed;
  const tone =
    state === "ok"
      ? "text-success border-success/40 bg-success/10 shadow-[0_0_20px_-8px_hsl(var(--success)/0.6)]"
      : state === "error"
        ? "text-destructive border-destructive/40 bg-destructive/10"
        : "text-muted-foreground border-border bg-muted/40";
  return (
    <div className={`rounded-lg border px-3 py-2 backdrop-blur-sm transition-smooth ${tone}`}>
      <div className="flex items-center gap-1.5 text-xs font-medium">
        <Icon className="h-3.5 w-3.5" />
        {label}
      </div>
      <p className="mt-0.5 text-[11px] opacity-80 break-all">{detail}</p>
    </div>
  );
};

export default StepPill;
