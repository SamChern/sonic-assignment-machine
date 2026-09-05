import { Card } from "@/components/ui/card";

interface SemanticAnalysisStatsProps {
  totals: { total: number; normalized: number; created: number; scored: number };
}

export const SemanticAnalysisStats = ({ totals }: SemanticAnalysisStatsProps) => (
  <div className="grid gap-3 sm:grid-cols-4">
    {([
      ["Identifiers", totals.total, "var(--gradient-cognitive)"],
      ["Normalized", totals.normalized, "var(--gradient-contextual)"],
      ["Sources created", totals.created, "var(--gradient-social)"],
      ["Scored", totals.scored, "var(--gradient-artistic)"],
    ] as const).map(([label, value, gradient]) => (
      <Card
        key={label}
        className="relative overflow-hidden border-border/60 bg-card/70 p-4 backdrop-blur-sm transition-smooth hover:shadow-elegant"
      >
        <span
          aria-hidden
          className="absolute inset-x-0 top-0 h-1"
          style={{ background: gradient }}
        />
        <p className="text-xs text-muted-foreground">{label}</p>
        <p
          className="bg-clip-text text-3xl font-semibold text-transparent"
          style={{ backgroundImage: gradient }}
        >
          {value}
        </p>
      </Card>
    ))}
  </div>
);

export default SemanticAnalysisStats;
