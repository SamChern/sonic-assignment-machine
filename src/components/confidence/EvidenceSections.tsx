import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { AlertTriangle, Info } from "lucide-react";
import { SCORE_KEYS, type TagRow } from "@/lib/confidenceBreakdown";

interface Props {
  tags: TagRow[];
  analysis: Record<string, number | string | null> | null;
  reasons: string[];
  fixes: string[];
}

/** Resolved node weights, per-category scores, and the why-low / how-to-raise lists. */
export const NodeWeightsAndScores = ({
  tags,
  analysis,
}: Pick<Props, "tags" | "analysis">) => (
  <>
    {/* tag weights */}
    {tags.length > 0 && (
      <div className="mt-5">
        <p className="text-xs font-medium">Resolved ontology nodes and weights</p>
        <div className="mt-2 space-y-2">
          {tags.map((t, i) => (
            <div key={i} className="flex items-center gap-3">
              <span className="w-64 shrink-0 truncate text-xs">
                {t.taxonomy_nodes?.label ?? "unknown node"}
              </span>
              <Progress value={Math.min(100, Number(t.weight) * 100)} className="h-1.5" />
              <span className="w-12 shrink-0 text-right font-mono text-[11px] text-muted-foreground">
                {Number(t.weight).toFixed(2)}
              </span>
            </div>
          ))}
        </div>
        <div className="mt-2 flex flex-wrap gap-1">
          {tags.map((t, i) => (
            <Badge key={i} variant="secondary" className="font-mono text-[10px]">
              {t.taxonomy_nodes?.code}
            </Badge>
          ))}
        </div>
      </div>
    )}

    {/* per-category scores */}
    {analysis && (
      <div className="mt-5 grid gap-2 sm:grid-cols-3">
        {SCORE_KEYS.map(([k, label]) => (
          <div key={k} className="rounded-md border border-border px-3 py-2">
            <p className="text-[11px] text-muted-foreground">{label}</p>
            <p className="text-sm font-semibold">{Math.round(Number(analysis[k]) || 0)}</p>
          </div>
        ))}
      </div>
    )}
  </>
);

export const WhyLowList = ({ reasons }: Pick<Props, "reasons">) => {
  if (reasons.length === 0) return null;
  return (
    <div className="mt-5 rounded-md border border-destructive/30 bg-destructive/5 p-3">
      <div className="flex items-center gap-1.5 text-xs font-medium text-destructive">
        <AlertTriangle className="h-3.5 w-3.5" />
        Why confidence is low
      </div>
      <ul className="mt-2 space-y-1.5 text-xs text-muted-foreground">
        {reasons.map((r, i) => (
          <li key={i} className="flex gap-2">
            <span className="text-destructive">•</span>
            <span>{r}</span>
          </li>
        ))}
      </ul>
    </div>
  );
};

export const WhatWouldRaiseIt = ({ fixes }: Pick<Props, "fixes">) => (
  <div className="mt-4 rounded-md border border-border p-3">
    <div className="flex items-center gap-1.5 text-xs font-medium">
      <Info className="h-3.5 w-3.5 text-primary" />
      What would raise it
    </div>
    <ul className="mt-2 space-y-1.5 text-xs text-muted-foreground">
      {fixes.map((f) => (
        <li key={f} className="flex gap-2">
          <span className="text-primary">•</span>
          <span>{f}</span>
        </li>
      ))}
    </ul>
  </div>
);
