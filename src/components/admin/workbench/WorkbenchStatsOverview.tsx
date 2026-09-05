import { Card } from "@/components/ui/card";

interface WorkbenchStatsOverviewProps {
  usersCount: number;
  sourcesCount: number;
  selectedCount: number;
  fingerprintsCount: number;
}

/** Top-of-page quick stats grid. */
export function WorkbenchStatsOverview({
  usersCount,
  sourcesCount,
  selectedCount,
  fingerprintsCount,
}: WorkbenchStatsOverviewProps) {
  return (
    <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
      {([
        ["Users", String(usersCount), "var(--gradient-cognitive)"],
        ["Audio sources", String(sourcesCount), "var(--gradient-contextual)"],
        ["Selected", String(selectedCount), "var(--gradient-social)"],
        ["Fingerprints", String(fingerprintsCount), "var(--gradient-artistic)"],
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
            className="truncate bg-clip-text text-2xl font-semibold text-transparent sm:text-3xl"
            style={{ backgroundImage: gradient }}
          >
            {value}
          </p>
        </Card>
      ))}
    </div>
  );
}
