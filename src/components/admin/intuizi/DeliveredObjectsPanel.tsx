import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CloudDownload, Loader2, Play } from "lucide-react";

export const DeliveredObjectsPanel = ({
  keys,
  ingesting,
  onIngest,
}: {
  keys: string[];
  ingesting: boolean;
  onIngest: () => void;
}) => {
  return (
    <div className="rounded-lg border border-border bg-muted/20 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <CloudDownload className="h-4 w-4 text-primary" />
        <p className="text-xs font-medium">Delivered objects</p>
        <Badge variant="outline" className="text-[11px]">{keys.length}</Badge>
        <Button
          size="sm"
          className="ml-auto"
          onClick={onIngest}
          disabled={!keys.length || ingesting}
        >
          {ingesting ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Play className="mr-1 h-4 w-4" />}
          Ingest these
        </Button>
      </div>
      {keys.length ? (
        <ul className="mt-2 space-y-1">
          {keys.map((k) => (
            <li key={k} className="font-mono text-[10px] break-all text-muted-foreground">• {k}</li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-[11px] text-muted-foreground">
          Open a completed activation above — its delivery keys land here and go straight into
          `intuizi-ingest` (taxonomy tagging → six-category scoring → calibration → speech-skew
          normalization, all unchanged).
        </p>
      )}
    </div>
  );
};
