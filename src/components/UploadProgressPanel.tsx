import { Activity, Sparkles } from "lucide-react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export type UploadProgressStatus = "idle" | "checking-cache" | "analyzing" | "complete";

export interface UploadProgressPanelProps {
  status: UploadProgressStatus;
  total: number;
  className?: string;
}

const STATUS_LABEL: Record<UploadProgressStatus, string> = {
  idle: "Preparing analysis...",
  "checking-cache": "Checking semantic cache...",
  analyzing: "Running AI semantic analysis...",
  complete: "Finalizing results...",
};

const STATUS_HINT: Partial<Record<UploadProgressStatus, string>> = {
  "checking-cache": "Looking up previously analyzed sources to speed up processing...",
  analyzing:
    "Extracting semantic features via hierarchical transformer and aligning modalities",
};

/**
 * Upload/analysis progress panel.
 * On mobile it docks just above the sticky bottom nav (`.docked-above-nav` keeps it
 * clear of the nav height + iOS/Android safe-area inset and below the nav in the
 * z-scale). From `sm` up it renders inline in the page flow.
 */
export function UploadProgressPanel({ status, total, className }: UploadProgressPanelProps) {
  return (
    <div
      data-testid="upload-progress-panel"
      role="status"
      aria-live="polite"
      className={cn("docked-above-nav", className)}
    >
      <Card className="p-4 shadow-elegant sm:p-8">
        <div className="space-y-3 text-center sm:space-y-4">
          <div className="flex justify-center">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent sm:h-16 sm:w-16" />
          </div>

          <div className="space-y-2">
            <p className="text-sm font-semibold text-foreground sm:text-lg">
              {STATUS_LABEL[status]}
            </p>

            <div className="flex flex-wrap justify-center gap-2 text-xs sm:gap-4 sm:text-sm">
              <div className="flex items-center gap-1.5 rounded-full bg-secondary/20 px-3 py-1.5">
                <Activity className="h-3.5 w-3.5 animate-pulse text-primary" />
                <span className="text-muted-foreground">
                  {total} source{total !== 1 ? "s" : ""}
                </span>
              </div>

              {status === "analyzing" && (
                <div className="flex items-center gap-1.5 rounded-full bg-primary/10 px-3 py-1.5">
                  <Sparkles className="h-3.5 w-3.5 text-primary" />
                  <span className="font-medium text-primary">Agent processing...</span>
                </div>
              )}
            </div>

            {STATUS_HINT[status] && (
              <p className="hidden text-xs text-muted-foreground sm:block">
                {STATUS_HINT[status]}
              </p>
            )}
          </div>
        </div>
      </Card>
    </div>
  );
}

export default UploadProgressPanel;
