import { Fingerprint } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

export interface OriginalityDetail {
  score?: number;
  evidence?: number;
  parts?: { grounding?: number; taxonomy?: number; craft?: number };
  summary?: string;
}

/**
 * Originality Score — one number, three ingredients: grounding confidence,
 * how tightly the audio matched ontology nodes, and the pitch/rhythm/timbre
 * craft spread. Low-evidence scores are marked provisional rather than hidden.
 */
export const OriginalityBadge = ({
  score,
  detail,
  compact = false,
}: {
  score: number | null | undefined;
  detail?: OriginalityDetail | null;
  compact?: boolean;
}) => {
  if (score === null || score === undefined || !Number.isFinite(Number(score))) return null;

  const value = Math.round(Number(score));
  const evidence = Number(detail?.evidence ?? 0);
  const provisional = evidence < 0.35;
  const tone =
    value >= 70
      ? "border-primary/50 bg-primary/10 text-primary"
      : value >= 40
        ? "border-border/60 bg-muted/20 text-foreground"
        : "border-border/50 bg-muted/10 text-muted-foreground";

  const chip = (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium ${tone}`}
    >
      <Fingerprint className="h-3 w-3" />
      {compact ? value : `Originality ${value}`}
      {provisional && <span className="opacity-70">·prov</span>}
    </span>
  );

  if (!detail?.summary && !detail?.parts) return chip;

  return (
    <Tooltip>
      <TooltipTrigger asChild>{chip}</TooltipTrigger>
      <TooltipContent className="max-w-[240px] space-y-1 text-[11px]">
        {detail?.summary && <p>{detail.summary}</p>}
        {detail?.parts && (
          <ul className="space-y-0.5 text-muted-foreground">
            <li>Grounding {Math.round(detail.parts.grounding ?? 0)}</li>
            <li>Taxonomy distance {Math.round(detail.parts.taxonomy ?? 0)}</li>
            <li>Musical craft {Math.round(detail.parts.craft ?? 0)}</li>
          </ul>
        )}
        {provisional && (
          <p className="text-muted-foreground">
            Provisional — little audio evidence behind this score yet.
          </p>
        )}
      </TooltipContent>
    </Tooltip>
  );
};

export default OriginalityBadge;
