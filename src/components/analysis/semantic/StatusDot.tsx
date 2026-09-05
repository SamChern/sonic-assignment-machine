import { StepState } from "@/lib/semanticAnalysis";

export const StatusDot = ({ state, title }: { state: StepState; title: string }) => (
  <span
    title={`${title}: ${state}`}
    aria-label={`${title}: ${state}`}
    className={`h-2 w-2 rounded-full ${
      state === "ok" ? "bg-success" : state === "error" ? "bg-destructive" : "bg-muted-foreground/50"
    }`}
  />
);

export default StatusDot;
