/**
 * Sticky header for the Intuizi Console page: back nav, ingest run/resume
 * controls and the manual refresh button.
 */
import { Activity, ArrowLeft, Loader2, PlayCircle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { IngestState } from "@/lib/integrationStatusData";

interface IntegrationStatusHeaderProps {
  ingestState: IngestState | null;
  running: boolean;
  refreshing: boolean;
  fetchedAt: Date | null;
  onBack: () => void;
  onInvokeIngest: (action: "run_now" | "resume") => void;
  onRefresh: () => void;
}

const IntegrationStatusHeader = ({
  ingestState,
  running,
  refreshing,
  fetchedAt,
  onBack,
  onInvokeIngest,
  onRefresh,
}: IntegrationStatusHeaderProps) => {
  return (
    <header className="border-b border-border bg-card/40 backdrop-blur sticky top-0 z-10">
      <div className="container mx-auto px-4 sm:px-6 py-3 sm:py-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={onBack}>
            <ArrowLeft className="h-4 w-4 mr-1" /> Back
          </Button>
          <div className="flex items-center gap-2">
            <Activity className="h-5 w-5 text-primary" />
            <h1 className="text-lg sm:text-xl font-semibold truncate">Intuizi Console</h1>
          </div>
        </div>
        <div className="flex items-center gap-2 sm:gap-3 overflow-x-auto no-scrollbar -mx-1 px-1">
          {ingestState?.paused ? (
            <Button variant="default" size="sm" onClick={() => onInvokeIngest("resume")} disabled={running}>
              {running ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <PlayCircle className="h-4 w-4 mr-2" />}
              Resume ingest
            </Button>
          ) : (
            <Button variant="secondary" size="sm" onClick={() => onInvokeIngest("run_now")} disabled={running}>
              {running ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <PlayCircle className="h-4 w-4 mr-2" />}
              Run ingest
            </Button>
          )}
          <span className="text-xs text-muted-foreground hidden sm:inline">
            {fetchedAt ? `Updated ${fetchedAt.toLocaleTimeString()}` : "Loading…"}
          </span>
          <Button variant="outline" size="sm" onClick={onRefresh} disabled={refreshing}>
            {refreshing ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4 mr-2" />
            )}
            Refresh
          </Button>
        </div>
      </div>
    </header>
  );
};

export default IntegrationStatusHeader;
