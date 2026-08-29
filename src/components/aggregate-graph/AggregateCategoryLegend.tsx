import { Card } from "@/components/ui/card";
import { CATEGORY_AXES } from "@/components/graph/adapters/aggregate";

/** Static six-category key beneath the aggregate graph. */
export const AggregateCategoryLegend = () => (
  <Card className="p-4 bg-card/50">
    <div className="flex flex-wrap items-center justify-center gap-4 text-sm">
      {CATEGORY_AXES.map((cat) => {
        const Icon = cat.icon;
        return (
          <div key={cat.key} className="flex items-center gap-1.5">
            <div className="w-3 h-3 rounded-full" style={{ backgroundColor: cat.color }} />
            <Icon className="h-3 w-3" style={{ color: cat.color }} />
            <span className="text-muted-foreground">{cat.name}</span>
          </div>
        );
      })}
    </div>
    <p className="text-center text-xs text-muted-foreground mt-2">
      Dashed outlines show cluster boundaries • Solid lines connect similar users within clusters
    </p>
  </Card>
);
