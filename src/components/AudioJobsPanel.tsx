import { useState } from "react";
import { AlertTriangle, CheckCircle2, ChevronDown, Clock, Loader2, PauseCircle, RefreshCw, Waves } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { useAudioJobs, type AudioJob } from "@/hooks/useAudioJobs";

interface AudioJobsPanelProps {
  /** Admins can watch the whole queue instead of just their own jobs. */
  allUsers?: boolean;
  className?: string;
  /** Start expanded (defaults to collapsed so the queue stays out of the way). */
  defaultOpen?: boolean;
}

function statusMeta(job: AudioJob) {
  switch (job.status) {
    case "processing":
      return {
        label: "Analyzing",
        icon: <Loader2 className="h-3.5 w-3.5 animate-spin" />,
        tone: "text-primary border-primary/40 bg-primary/10",
      };
    case "pending":
      return {
        label: job.queue_position ? `Queued · #${job.queue_position}` : "Queued",
        icon: <Clock className="h-3.5 w-3.5" />,
        tone: "text-muted-foreground border-muted-foreground/30 bg-muted/40",
      };
    case "done":
      return {
        label: "Complete",
        icon: <CheckCircle2 className="h-3.5 w-3.5" />,
        tone: "text-emerald-400 border-emerald-400/40 bg-emerald-400/10",
      };
    default:
      return {
        label: "Failed",
        icon: <AlertTriangle className="h-3.5 w-3.5" />,
        tone: "text-destructive border-destructive/40 bg-destructive/10",
      };
  }
}

export const AudioJobsPanel = ({
  allUsers = false,
  className = "",
  defaultOpen = false,
}: AudioJobsPanelProps) => {
  const [open, setOpen] = useState(defaultOpen);
  const { jobs, worker, activeCount, queueDepth, loading, error, refresh } = useAudioJobs({
    allUsers,
    limit: allUsers ? 50 : 15,
  });

  if (!error && jobs.length === 0 && !worker?.paused) return null;

  return (
    <Card className={`border-border/60 bg-card/70 backdrop-blur-md p-4 sm:p-5 space-y-4 ${className}`}>
      <div className="flex items-start justify-between gap-3">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-controls="audio-jobs-details"
          className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
        >
          <div className="rounded-lg p-2 gradient-teal">
            <Waves className="h-4 w-4 text-background" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-foreground">
              Background audio processing
            </h3>
            <p className="text-xs text-muted-foreground">
              {activeCount > 0
                ? `${activeCount} job${activeCount > 1 ? "s" : ""} in flight · queue depth ${queueDepth}`
                : "No jobs in flight — you can leave this page and check back later."}
            </p>
          </div>
          <ChevronDown
            className={`ml-auto h-4 w-4 shrink-0 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`}
            aria-hidden="true"
          />
        </button>
        {open && (
        <Button
          size="sm"
          variant="outline"
          onClick={() => refresh(true)}
          disabled={loading}
          className="shrink-0"
        >
          <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </Button>
        )}
      </div>

      {open && (
      <div id="audio-jobs-details" className="space-y-4">
      {worker?.paused && (
        <div className="flex items-start gap-2 rounded-md border border-amber-400/40 bg-amber-400/10 p-3 text-xs text-amber-200">
          <PauseCircle className="h-4 w-4 mt-0.5 shrink-0" />
          <span>
            Processing is paused{worker.pause_reason ? `: ${worker.pause_reason}` : ""}. Queued
            uploads are kept and will resume once an admin clears the pause.
          </span>
        </div>
      )}

      {error && (
        <p className="text-xs text-destructive">{error}</p>
      )}

      <div className="space-y-2.5">
        {jobs.map((job) => {
          const meta = statusMeta(job);
          return (
            <div
              key={job.id}
              className="rounded-lg border border-border/50 bg-background/40 p-3 space-y-2"
            >
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-medium text-foreground truncate">
                  {job.source_name ?? job.kind}
                </p>
                <Badge variant="outline" className={`gap-1.5 shrink-0 ${meta.tone}`}>
                  {meta.icon}
                  {meta.label}
                </Badge>
              </div>
              <Progress value={job.progress} className="h-1.5" />
              <div className="flex items-center justify-between gap-3 text-[11px] text-muted-foreground">
                <span>
                  Started {new Date(job.created_at).toLocaleString()}
                  {job.attempts > 1 ? ` · attempt ${job.attempts}` : ""}
                </span>
                {job.status === "failed" && job.last_error && (
                  <span className="text-destructive truncate max-w-[55%]" title={job.last_error}>
                    {job.last_error}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
      </div>
      )}
    </Card>
  );
};
