import { Card } from "@/components/ui/card";
import type { OutcomeResult } from "@/components/enterprise/outcomes/types";

export const TopPerformersCard = ({ result }: { result: OutcomeResult }) => {
  return (
    <Card className="p-4">
      <h3 className="text-sm font-semibold">Predicted top performers</h3>
      <div className="mt-3 space-y-1">
        {result.top_predicted.map((t, i) => (
          <div
            key={t.record_id}
            className="flex items-center gap-2 rounded-lg border border-border/50 bg-muted/10 p-2 text-xs"
          >
            <span className="w-6 text-muted-foreground">{i + 1}</span>
            <span className="min-w-0 flex-1 truncate">{t.label}</span>
            <span className="font-medium">{t.predicted.toFixed(4)}</span>
            {t.actual !== null && (
              <span className="text-muted-foreground">actual {t.actual.toFixed(4)}</span>
            )}
          </div>
        ))}
      </div>
    </Card>
  );
};
