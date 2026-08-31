import { Globe2, TrendingUp } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { MarketOriginality } from "@/lib/marketOriginality";

const tone = (v: number) =>
  v >= 65 ? "text-primary" : v >= 35 ? "text-foreground" : "text-muted-foreground";

/** Compact chip for list rows: market originality plus the cohort behind it. */
export const MarketOriginalityBadge = ({ market }: { market: MarketOriginality }) => {
  if (market.score === null) return null;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex items-center gap-1 rounded-full border border-border/60 bg-muted/20 px-2 py-0.5 text-[10px] font-medium">
          <Globe2 className="h-3 w-3" />
          Market {market.score}
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-[260px] space-y-1 text-[11px]">
        <p>{market.summary}</p>
        <p className="text-muted-foreground">
          vs {market.marketLabel.toLowerCase()} · {market.sampleSize.toLocaleString()} reference
          tracks
        </p>
      </TooltipContent>
    </Tooltip>
  );
};

/**
 * Market originality panel — where a measured track sits against real released
 * music, per axis, with the reference cohort named on every row so the number
 * is quotable rather than mysterious.
 */
export const MarketOriginalityPanel = ({
  title,
  market,
}: {
  title: string;
  market: MarketOriginality;
}) => {
  if (market.score === null) {
    return (
      <Card className="border-border/60 bg-card/70 p-3 text-[11px] text-muted-foreground">
        {market.summary}
      </Card>
    );
  }

  return (
    <Card className="border-border/60 bg-card/70 p-3">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <Globe2 className="h-4 w-4 text-primary" />
        <h3 className="truncate text-sm font-semibold">{title} vs the market</h3>
        <Badge variant="secondary" className="text-[10px]">
          {market.marketLabel}
        </Badge>
        <div className="ml-auto text-right">
          <p className={`text-lg font-semibold leading-none ${tone(market.score)}`}>
            {market.score}
          </p>
          <p className="text-[10px] text-muted-foreground">market originality</p>
        </div>
      </div>

      <p className="mb-3 text-[11px] text-muted-foreground">{market.summary}</p>

      <ul className="space-y-2">
        {market.metrics.map((m) => (
          <li key={m.metric}>
            <div className="mb-1 flex items-center justify-between gap-2 text-[10px]">
              <span className="flex items-center gap-1">
                <TrendingUp className="h-3 w-3 text-muted-foreground" />
                <span className="font-medium">{m.label}</span>
                <span className="text-muted-foreground">
                  {m.value}
                  {m.unit && m.unit !== "0-100" ? ` ${m.unit}` : ""} · market {m.marketMean}
                </span>
              </span>
              <span className={tone(m.distinctiveness)}>
                {m.percentile}th pct · {m.basis === "live" ? "live cohort" : "published"}
              </span>
            </div>
            <Progress value={m.distinctiveness} className="h-1.5" />
            <p className="mt-1 text-[10px] text-muted-foreground">{m.note}</p>
          </li>
        ))}
      </ul>

      <p className="mt-3 text-[10px] text-muted-foreground">
        Reference cohort: {market.sampleSize.toLocaleString()} tracks ·{" "}
        {Math.round(market.confidence * 100)}% of the comparison backed by measured audio.
      </p>
    </Card>
  );
};

export default MarketOriginalityPanel;
