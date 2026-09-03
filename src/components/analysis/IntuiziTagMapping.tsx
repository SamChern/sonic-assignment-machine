import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ChevronDown, ChevronUp, Tags } from "lucide-react";
import { cn } from "@/lib/utils";
import { getCategoryIcon, getCategoryStyles } from "@/components/AnalysisResults";
import { useTagAttribution } from "@/hooks/useTagAttribution";
import { tagDelta } from "@/lib/tagAttribution";

interface Props {
  audioSourceId: string;
  /** Model score per lowercase category, so each column can show the gap. */
  scores: Record<string, number>;
  refreshKey?: number;
  className?: string;
}

const title = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * Intuizi taxonomy → category mapping for one analysed source.
 *
 * Each of the six categories lists the taxonomy tags that actually drive it,
 * with the tag's weight on this source, its learned score in that category and
 * its share of the category's tag evidence — so the dashboard explains the
 * score instead of only reporting the average.
 */
export const IntuiziTagMapping = ({
  audioSourceId,
  scores,
  refreshKey = 0,
  className,
}: Props) => {
  const { attribution, tagCount, loading } = useTagAttribution(audioSourceId, refreshKey);
  const [open, setOpen] = useState(false);

  if (loading && !attribution) {
    return (
      <div className={cn("mt-4 h-20 animate-pulse rounded-xl bg-secondary/20", className)} />
    );
  }
  if (!attribution || !attribution.some((a) => a.tags.length)) return null;

  const mapped = attribution.filter((a) => a.tags.length);

  return (
    <div
      className={cn(
        "mt-4 rounded-xl border border-border/50 bg-muted/10 p-3 sm:p-4",
        className,
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        <Tags className="h-4 w-4 text-primary" />
        <h4 className="text-sm font-semibold">Intuizi taxonomy mapping</h4>
        <Badge variant="secondary" className="text-[10px]">
          {tagCount} tags · {mapped.length}/6 categories
        </Badge>
        <Button
          variant="ghost"
          size="sm"
          className="ml-auto h-7 px-2 text-xs"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
        >
          {open ? "Hide detail" : "Tag-to-score detail"}
          {open ? (
            <ChevronUp className="ml-1 h-3.5 w-3.5" />
          ) : (
            <ChevronDown className="ml-1 h-3.5 w-3.5" />
          )}
        </Button>
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {mapped.map((attr) => {
          const styles = getCategoryStyles(attr.category);
          const modelScore = Math.round(scores[attr.category] ?? 0);
          const delta = tagDelta(modelScore, attr);
          const shown = open ? attr.tags : attr.tags.slice(0, 3);

          return (
            <div
              key={attr.category}
              className={cn("rounded-lg border bg-card/60 p-3", styles.border)}
            >
              <div className="flex items-center gap-2">
                <span className={styles.text}>{getCategoryIcon(attr.category)}</span>
                <span className={cn("text-xs font-semibold", styles.text)}>
                  {title(attr.category)}
                </span>
                <span className="ml-auto font-mono text-[11px] text-muted-foreground">
                  tags {attr.tagScore ?? "—"} / model {modelScore}
                </span>
              </div>

              {delta !== null && (
                <p className="mt-1 text-[10px] text-muted-foreground">
                  {delta === 0
                    ? "Tags and model agree"
                    : `Model runs ${Math.abs(delta)} pt ${delta > 0 ? "above" : "below"} its tags`}
                  {" · "}
                  {attr.observations} observations
                </p>
              )}

              <ul className="mt-2 space-y-1.5">
                {shown.map((t) => (
                  <li key={t.code}>
                    <div className="flex items-center gap-2 text-[11px]">
                      <span className="truncate" title={t.code}>
                        {t.label}
                      </span>
                      {t.thin && (
                        <Badge
                          variant="outline"
                          className="h-4 shrink-0 px-1 text-[9px] text-muted-foreground"
                        >
                          thin
                        </Badge>
                      )}
                      <span className="ml-auto shrink-0 font-mono text-muted-foreground">
                        {Math.round(t.meanScore)}
                      </span>
                    </div>
                    <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-muted">
                      <div
                        className={cn(
                          "h-full rounded-full",
                          styles.text.replace("text-", "bg-"),
                        )}
                        style={{ width: `${Math.round(t.share * 100)}%` }}
                      />
                    </div>
                    {open && (
                      <div className="mt-0.5 flex gap-3 text-[10px] text-muted-foreground">
                        <span>weight {t.weight.toFixed(2)}</span>
                        <span>share {Math.round(t.share * 100)}%</span>
                        <span>n {t.n}</span>
                      </div>
                    )}
                  </li>
                ))}
              </ul>

              {!open && attr.tags.length > shown.length && (
                <p className="mt-1.5 text-[10px] text-muted-foreground">
                  +{attr.tags.length - shown.length} more tags
                </p>
              )}
            </div>
          );
        })}
      </div>

      <p className="mt-3 text-[10px] leading-relaxed text-muted-foreground">
        Tag scores are the calibrated mean this taxonomy node has earned in the
        category across every analysis, weighted by the tag's strength on this
        source. Bars show each tag's share of that category's evidence.
      </p>
    </div>
  );
};

export default IntuiziTagMapping;
