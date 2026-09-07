import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { CATEGORY_KEYS, type CategoryKey } from "@/lib/enterpriseSchema";
import { prettyTag, type AudienceInsights, type InsightFamily } from "@/hooks/useAudienceInsights";

const num = (n: number) => n.toLocaleString();

const topAxis = (scores: Record<CategoryKey, number>) => {
  let best: CategoryKey = CATEGORY_KEYS[0];
  for (const c of CATEGORY_KEYS) if ((scores[c] ?? 0) > (scores[best] ?? 0)) best = c;
  return best;
};

const FamilyCard = ({ family }: { family: InsightFamily }) => {
  const max = Math.max(1, ...family.tags.map((t) => t.count));
  return (
    <Card className="border-border/60 p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold capitalize text-foreground">{family.family}</h2>
        <p className="text-[11px] text-muted-foreground">
          {num(family.distinct_tags)} distinct · {num(family.total_mentions)} mentions
        </p>
      </div>
      <ul className="mt-3 space-y-2.5">
        {family.tags.map((t) => {
          const lead = topAxis(t.scores);
          return (
            <li key={t.code}>
              <div className="flex flex-wrap items-baseline justify-between gap-2 text-xs">
                <span className="min-w-0 truncate capitalize text-foreground" title={t.code}>
                  {prettyTag(t.code)}
                </span>
                <span className="shrink-0 text-muted-foreground">
                  {num(t.count)} · {t.share}%
                </span>
              </div>
              <div className="mt-1 h-1.5 overflow-hidden rounded bg-muted">
                <div
                  className="h-full rounded"
                  style={{
                    width: `${Math.max(2, (t.count / max) * 100)}%`,
                    background: `hsl(var(--category-${lead}))`,
                  }}
                />
              </div>
              <p className="mt-1 text-[10px] text-muted-foreground">
                strongest <span className="capitalize">{lead}</span> {(t.scores[lead] ?? 0).toFixed(0)} ·
                confidence {t.confidence}
              </p>
            </li>
          );
        })}
      </ul>
    </Card>
  );
};

/** Tag, demographic and score make-up of the sampled listener population. */
const AudienceInsightsPanels = ({
  data,
  loading,
}: {
  data: AudienceInsights | null;
  loading: boolean;
}) => {
  if (loading && !data) {
    return (
      <div className="grid gap-3 lg:grid-cols-2">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-64 w-full" />
        ))}
      </div>
    );
  }

  if (!data) return null;

  const everyTag = data.families.flatMap((f) => f.tags);
  const headline = [...everyTag].sort((a, b) => b.count - a.count).slice(0, 6);

  return (
    <div className="space-y-6">
      <Card className="border-border/60 p-4">
        <h2 className="text-sm font-semibold text-foreground">What shows up most</h2>
        <p className="mt-0.5 text-[11px] text-muted-foreground">
          Across {num(data.sampled_profiles)} sampled listener profiles.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          {headline.map((t) => (
            <Badge key={t.code} variant="outline" className="text-[11px] capitalize" title={t.code}>
              {prettyTag(t.code)} · {t.share}%
            </Badge>
          ))}
        </div>
      </Card>

      <div className="grid gap-3 lg:grid-cols-2">
        {data.families.map((f) => (
          <FamilyCard key={f.family} family={f} />
        ))}
      </div>
    </div>
  );
};

export default AudienceInsightsPanels;
