import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  AlertTriangle,
  CheckCircle2,
  Cpu,
  Loader2,
  MinusCircle,
  RefreshCw,
  ShieldAlert,
  Sparkles,
} from "lucide-react";
import type { InferenceReadiness } from "@/hooks/useInferenceReadiness";

interface Props {
  readiness: InferenceReadiness | null;
  loading: boolean;
  error: string | null;
  onRecheck: () => void;
  /** Hide the panel entirely when everything is configured correctly. */
  hideWhenOk?: boolean;
}

const stateStyle = {
  ok: { mark: "✓", tone: "text-primary", word: "passed" },
  warn: { mark: "!", tone: "text-amber-600", word: "warning" },
  fail: { mark: "✕", tone: "text-destructive", word: "failed" },
  skipped: { mark: "–", tone: "text-muted-foreground", word: "skipped" },
} as const;

/**
 * Surfaces the inference routing verdict next to any "run semantic analysis"
 * action. Running scoring on Lovable AI is an intentional configuration, so it
 * is presented as such — the action is only disabled on a hard block.
 */
const InferenceConfigGuard = ({ readiness, loading, error, onRecheck, hideWhenOk }: Props) => {
  if (loading) {
    return (
      <p className="flex items-center gap-2 text-xs text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        Checking inference routing…
      </p>
    );
  }

  if (error) {
    return (
      <Alert variant="destructive">
        <ShieldAlert className="h-4 w-4" />
        <AlertTitle className="text-sm">Inference configuration could not be validated</AlertTitle>
        <AlertDescription className="text-xs">
          {error} — semantic processing stays disabled until the check succeeds.
          <Button variant="outline" size="sm" className="ml-2 h-7" onClick={onRecheck}>
            <RefreshCw className="mr-1 h-3 w-3" /> Re-check
          </Button>
        </AlertDescription>
      </Alert>
    );
  }

  if (!readiness) return null;
  if (readiness.verdict === "ok" && hideWhenOk) return null;

  const blocked = readiness.blocked;
  const gatewayByDesign = readiness.chat_provider === "gateway" && !readiness.selected_chat_model;
  const skipped = readiness.checks.filter((c) => c.state === "skipped");
  const passed = readiness.checks.filter((c) => c.state === "ok");
  const problems = readiness.checks.filter((c) => c.state === "fail" || c.state === "warn");

  return (
    <Alert
      variant={blocked ? "destructive" : "default"}
      className={blocked ? "" : gatewayByDesign ? "border-primary/30" : "border-amber-500/40"}
    >
      {blocked ? (
        <ShieldAlert className="h-4 w-4" />
      ) : gatewayByDesign ? (
        <Sparkles className="h-4 w-4" />
      ) : readiness.verdict === "warn" ? (
        <AlertTriangle className="h-4 w-4" />
      ) : (
        <CheckCircle2 className="h-4 w-4" />
      )}
      <AlertTitle className="flex flex-wrap items-center gap-2 text-sm">
        {blocked
          ? "Semantic processing blocked — EC2 inference is required but misconfigured"
          : gatewayByDesign
            ? "Semantic processing runs on Lovable AI (intentional)"
            : readiness.verdict === "warn"
              ? "Semantic processing available — some inference is not on EC2"
              : "EC2 inference verified"}
        <Badge variant="outline" className="gap-1 text-[10px]">
          <Cpu className="h-3 w-3" />
          {readiness.chat_provider === "ec2"
            ? "scoring on EC2"
            : readiness.chat_provider === "gateway"
              ? "scoring on Lovable AI"
              : "no scoring route"}
        </Badge>
        {readiness.selected_embedding_model && (
          <Badge variant="secondary" className="text-[10px]">
            embeddings on EC2: {readiness.selected_embedding_model}
          </Badge>
        )}
        {readiness.selected_chat_model && (
          <Badge variant="secondary" className="text-[10px]">{readiness.selected_chat_model}</Badge>
        )}
      </AlertTitle>
      <AlertDescription className="text-xs">
        <p>{readiness.summary}</p>
        {gatewayByDesign && !blocked && (
          <p className="mt-1 text-muted-foreground">
            No local scoring model is configured, so EC2 GPU checks are skipped by design and
            semantic processing is not blocked.
          </p>
        )}

        {!!problems.length && (
          <ul className="mt-2 space-y-1">
            {problems.map((c) => (
              <li key={c.id} className="flex gap-1.5">
                <span className={stateStyle[c.state].tone}>{stateStyle[c.state].mark}</span>
                <span>
                  <span className="font-medium">{c.label}:</span> {c.detail}
                </span>
              </li>
            ))}
          </ul>
        )}

        {!!passed.length && (
          <div className="mt-2">
            <p className="font-medium text-muted-foreground">Passed</p>
            <ul className="mt-0.5 space-y-0.5">
              {passed.map((c) => (
                <li key={c.id} className="flex gap-1.5">
                  <span className="text-primary">✓</span>
                  <span>
                    <span className="font-medium">{c.label}:</span> {c.detail}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {!!skipped.length && (
          <div className="mt-2">
            <p className="flex items-center gap-1 font-medium text-muted-foreground">
              <MinusCircle className="h-3 w-3" /> Skipped (not needed for this routing)
            </p>
            <ul className="mt-0.5 space-y-0.5 text-muted-foreground">
              {skipped.map((c) => (
                <li key={c.id} className="flex gap-1.5">
                  <span>–</span>
                  <span>
                    <span className="font-medium">{c.label}:</span> {c.detail}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <Button variant="outline" size="sm" className="mt-2 h-7" onClick={onRecheck}>
          <RefreshCw className="mr-1 h-3 w-3" /> Re-check configuration
        </Button>
      </AlertDescription>
    </Alert>
  );
};

export default InferenceConfigGuard;
