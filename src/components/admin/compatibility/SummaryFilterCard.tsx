import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { type Report, type Status, VERDICT_COPY } from "@/lib/compatibilityReport";
import { STATUS_META } from "./statusMeta";

interface SummaryFilterCardProps {
  report: Report;
  statusFilter: Status | "all";
  setStatusFilter: (s: Status | "all") => void;
}

export const SummaryFilterCard = ({ report, statusFilter, setStatusFilter }: SummaryFilterCardProps) => (
  <Card className="border-border/60 bg-card/60 p-5 backdrop-blur-sm">
    <div className="flex flex-wrap items-center gap-2">
      {(["all", "fail", "warn", "pass", "skip"] as const).map((s) => {
        const count = s === "all"
          ? report.summary.total
          : report.summary[s as Status];
        return (
          <Button
            key={s}
            size="sm"
            variant={statusFilter === s ? "default" : "outline"}
            onClick={() => setStatusFilter(s)}
          >
            {s === "all" ? "All" : STATUS_META[s as Status].label} ({count})
          </Button>
        );
      })}
    </div>
    <p className="mt-3 text-sm text-muted-foreground">
      {VERDICT_COPY[report.summary.verdict] ?? ""}{" "}
      {report.backend && (
        <>Backend <span className="font-medium text-foreground">{report.backend.backend}</span>.{" "}</>
      )}
      {report.discovered_objects != null && (
        <>{report.discovered_objects} object(s) discovered.{" "}</>
      )}
      Ran {new Date(report.ran_at).toLocaleTimeString()} in {report.duration_ms}ms.
    </p>
  </Card>
);
