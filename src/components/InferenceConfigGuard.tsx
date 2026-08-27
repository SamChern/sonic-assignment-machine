import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AlertTriangle, CheckCircle2, Cpu, Loader2, RefreshCw, ShieldAlert } from "lucide-react";
import type { InferenceReadiness } from "@/hooks/useInferenceReadiness";

interface Props {
  readiness: InferenceReadiness | null;
  loading: boolean;
  error: string | null;
  onRecheck: () => void;
  /** Hide the panel entirely when everything is configured correctly. */
  hideWhenOk?: boolean;
}

const tone = {
  ok: "text-primary",
  warn: "text-amber-600",
  fail: "text-destructive",
} as const;

/**
 * Surfaces the EC2 GPU inference configuration verdict next to any
 * "run semantic analysis" action. When blocked, the action must stay disabled.
 */
const InferenceConfigGuard = ({ readiness, loading, error, onRecheck, hideWhenOk }: Props) => {
  if (loading) {
    return (
      <p className="flex items-center gap-2 text-xs text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        Validating EC2 GPU inference configuration…
      </p>
    );
  }

  if (error) {
    return (
      <Alert variant="destructive">
        <ShieldAlert className="h-4 w-4" />
        <AlertTitle className="text-sm">Inference configuration could not be validated</AlertTitle>
        <AlertDescription className="text-xs">
          {error} — semantic analysis stays disabled until the check succeeds.
          <Button variant="outline" size="sm" className="ml-2 h-7" onClick={onRecheck}>
            <RefreshCw className="mr-1 h-3 w-3" /> Re-check
          </Button>
        </AlertDescription>
      </Alert>
    );
  }

  if (!readiness) return null;
  if (readiness.verdict === "ok" && hideWhenOk) return null;

  const blocked = readiness.verdict === "blocked";
  const problems = readiness.checks.filter((c) => c.state !== "ok");

  return (
    <Alert variant={blocked ? "destructive" : "default"} className={blocked ? "" : "border-amber-500/40"}>
      {blocked ? (
        <ShieldAlert className="h-4 w-4" />
      ) : readiness.verdict === "warn" ? (
        <AlertTriangle className="h-4 w-4" />
      ) : (
        <CheckCircle2 className="h-4 w-4" />
      )}
      <AlertTitle className="flex flex-wrap items-center gap-2 text-sm">
        {blocked
          ? "Semantic analysis blocked — EC2 GPU inference misconfigured"
          : readiness.verdict === "warn"
            ? "Semantic analysis available — some inference is not on EC2"
            : readiness.selected_chat_model
              ? "EC2 GPU inference verified"
              : "Inference routing verified"}

        <Badge variant="outline" className="gap-1 text-[10px]">
          <Cpu className="h-3 w-3" />
          {readiness.chat_provider === "ec2"
            ? "scoring on EC2"
            : readiness.chat_provider === "gateway"
              ? "scoring on Lovable AI"
              : "no scoring route"}
        </Badge>
        {readiness.selected_chat_model && (
          <Badge variant="secondary" className="text-[10px]">{readiness.selected_chat_model}</Badge>
        )}
        {readiness.gpu === false && readiness.selected_chat_model && (
          <Badge variant="outline" className="text-[10px] text-destructive">no GPU detected</Badge>
        )}

      </AlertTitle>
      <AlertDescription className="text-xs">
        <p>{readiness.summary}</p>
        {!!problems.length && (
          <ul className="mt-2 space-y-1">
            {problems.map((c) => (
              <li key={c.id} className="flex gap-1.5">
                <span className={tone[c.state]}>{c.state === "fail" ? "✕" : "!"}</span>
                <span>
                  <span className="font-medium">{c.label}:</span> {c.detail}
                </span>
              </li>
            ))}
          </ul>
        )}
        <Button variant="outline" size="sm" className="mt-2 h-7" onClick={onRecheck}>
          <RefreshCw className="mr-1 h-3 w-3" /> Re-check configuration
        </Button>
      </AlertDescription>
    </Alert>
  );
};

export default InferenceConfigGuard;
