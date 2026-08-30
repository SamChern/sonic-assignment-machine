import { useState } from "react";
import { ChevronDown, ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";

export type ConfidenceLevel = "high" | "moderate" | "indistinct";

export interface ConfidenceInputs {
  /** Step 14 grounding level of the underlying scores. */
  grounding?: string | null;
  /** Rows/members behind the result. */
  sample?: number | null;
  /** Width of the confidence interval, 0–1. */
  ciWidth?: number | null;
}

const LABEL: Record<ConfidenceLevel, string> = {
  high: "High confidence",
  moderate: "Moderate confidence",
  indistinct: "Not yet distinguishable",
};

const TONE: Record<ConfidenceLevel, string> = {
  high: "border-emerald-500/40 text-emerald-300",
  moderate: "border-amber-500/40 text-amber-300",
  indistinct: "border-border text-muted-foreground",
};

/**
 * Step 16b — one chip collapsing grounding level, sample sufficiency and CI width
 * into a single honest verdict, expandable to the detail behind it.
 */
export const confidenceLevel = ({
  grounding,
  sample,
  ciWidth,
}: ConfidenceInputs): ConfidenceLevel => {
  const grounded = grounding === "grounded" || grounding === "high";
  const n = sample ?? 0;
  const ci = ciWidth ?? 1;
  if (grounded && n >= 500 && ci <= 0.15) return "high";
  if (n >= 50 && ci <= 0.35) return "moderate";
  return "indistinct";
};

export const ConfidenceChip = (props: ConfidenceInputs) => {
  const [open, setOpen] = useState(false);
  const level = confidenceLevel(props);

  return (
    <div className="inline-flex flex-col items-start gap-1">
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <Badge variant="outline" className={`gap-1 ${TONE[level]}`}>
          <ShieldCheck className="h-3 w-3" />
          {LABEL[level]}
          <ChevronDown className={`h-3 w-3 transition-transform ${open ? "rotate-180" : ""}`} />
        </Badge>
      </button>
      {open && (
        <div className="rounded-md border border-border/60 bg-card/70 p-2 text-xs text-muted-foreground">
          <p>Grounding: {props.grounding ?? "unknown"}</p>
          <p>Sample: {props.sample === null || props.sample === undefined ? "—" : props.sample.toLocaleString()}</p>
          <p>
            Interval width:{" "}
            {props.ciWidth === null || props.ciWidth === undefined
              ? "—"
              : `±${Math.round(props.ciWidth * 50)}%`}
          </p>
        </div>
      )}
    </div>
  );
};

export default ConfidenceChip;
