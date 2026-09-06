import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { useCreatorSpace } from "@/hooks/useCreatorSpace";

type Space = ReturnType<typeof useCreatorSpace>;

/** Plain-language read of everything a creator has analysed so far. */
const CreatorAnalyticsPanel = ({ space }: { space: Space }) => {
  const { averages, analysedCount, strongest, quietest, analyses } = space;

  if (analysedCount === 0) {
    return (
      <Card className="p-6 text-center text-sm text-muted-foreground">
        Add a sound and run it once — your averages appear here straight after.
      </Card>
    );
  }

  const recent = analyses.slice(0, 8);

  return (
    <div className="space-y-3">
      <Card className="space-y-3 p-4">
        <div className="flex flex-wrap items-baseline gap-2">
          <h2 className="text-sm font-semibold text-foreground">Your average shape</h2>
          <span className="text-xs text-muted-foreground">
            across {analysedCount} {analysedCount === 1 ? "sound" : "sounds"}
          </span>
        </div>
        <ul className="space-y-2">
          {averages.map((c) => (
            <li key={c.key} className="space-y-1">
              <div className="flex items-center justify-between text-xs">
                <span className="text-foreground">{c.name}</span>
                <span className="tabular-nums text-muted-foreground">{c.value}</span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-secondary/40">
                <div
                  className="h-full rounded-full transition-all"
                  style={{ width: `${Math.max(2, c.value)}%`, backgroundColor: c.color }}
                />
              </div>
            </li>
          ))}
        </ul>
        {strongest && quietest && (
          <p className="text-xs text-muted-foreground">
            Your work leans most on <span className="text-foreground">{strongest.name}</span> and
            least on <span className="text-foreground">{quietest.name}</span>.
          </p>
        )}
      </Card>

      <Card className="p-4">
        <h2 className="mb-2 text-sm font-semibold text-foreground">Latest results</h2>
        <ul className="divide-y divide-border/50">
          {recent.map((a) => (
            <li key={a.id} className="flex flex-wrap items-center gap-2 py-2 text-xs">
              <span className="min-w-0 flex-1 truncate text-foreground">
                {a.source_name ?? "Untitled sound"}
              </span>
              {a.grounding_level && (
                <Badge variant="outline" className="px-1 py-0 text-[10px]">
                  {a.grounding_level.replace(/_/g, " ")}
                </Badge>
              )}
              <span className="text-muted-foreground">
                {new Date(a.created_at).toLocaleDateString()}
              </span>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
};

export default CreatorAnalyticsPanel;
