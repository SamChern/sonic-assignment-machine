import { Card } from "@/components/ui/card";
import type { AggregateMetrics } from "@/components/graph/adapters/aggregate";

/** Cross-user similarity summary: average, top pairs, community category profile. */
export const AggregateSimilarityCard = ({ metrics }: { metrics: AggregateMetrics }) => (
  <Card className="p-6 bg-card/80">
    <h4 className="font-semibold text-foreground mb-4">Cross-User Similarity Analysis</h4>

    <div className="grid md:grid-cols-2 gap-6">
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">Average User Similarity</span>
          <span className="text-2xl font-bold text-primary">
            {(metrics.averageSimilarity * 100).toFixed(0)}%
          </span>
        </div>
        <div className="h-2 bg-secondary rounded-full overflow-hidden">
          <div
            className="h-full bg-primary rounded-full transition-all"
            style={{ width: `${metrics.averageSimilarity * 100}%` }}
          />
        </div>

        <div className="mt-4">
          <p className="text-sm font-medium text-foreground mb-2">Most Similar Users</p>
          <div className="space-y-1">
            {metrics.pairs.slice(0, 3).map((pair, i) => (
              <div key={i} className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">
                  {pair.user1} ↔ {pair.user2}
                </span>
                <span className="font-medium text-foreground">
                  {(pair.similarity * 100).toFixed(0)}%
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="space-y-2">
        <p className="text-sm font-medium text-foreground mb-2">Community Category Profile</p>
        {metrics.categoryAverages.map((cat) => {
          const Icon = cat.icon;
          return (
            <div key={cat.key} className="flex items-center gap-2">
              <Icon className="h-4 w-4" style={{ color: cat.color }} />
              <span className="text-sm text-muted-foreground flex-1">{cat.name}</span>
              <div className="w-24 h-2 bg-secondary rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full"
                  style={{ width: `${cat.avg}%`, backgroundColor: cat.color }}
                />
              </div>
              <span className="text-sm font-medium w-8 text-right">{cat.avg.toFixed(0)}</span>
            </div>
          );
        })}
      </div>
    </div>
  </Card>
);
