import type { ReactNode } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { FileAudio } from "lucide-react";
import type { AudioSourceWithProfile } from "@/components/admin/workbench/types";

interface WorkbenchSourceRowArgs {
  source: AudioSourceWithProfile;
  showOwner?: boolean;
  selectedSourceIds: string[];
  toggleSourceSelection: (sourceId: string) => void;
  signalCounts: Record<string, number>;
}

/** Renders a single selectable audio-source row shared by the users and
 * providers views of the Users & Sources tab. */
export function renderWorkbenchSourceRow({
  source,
  showOwner = false,
  selectedSourceIds,
  toggleSourceSelection,
  signalCounts,
}: WorkbenchSourceRowArgs): ReactNode {
  return (
    <div
      key={source.id}
      className={`flex items-center gap-3 p-3 rounded-lg border transition-colors cursor-pointer ${
        selectedSourceIds.includes(source.id)
          ? 'bg-primary/10 border-primary/30'
          : 'bg-secondary/20 border-secondary/30 hover:bg-secondary/30'
      }`}
      onClick={() => toggleSourceSelection(source.id)}
    >
      <Checkbox
        checked={selectedSourceIds.includes(source.id)}
        onCheckedChange={() => toggleSourceSelection(source.id)}
      />
      {source.album_image ? (
        <img src={source.album_image} alt={source.name} className="w-10 h-10 rounded" />
      ) : (
        <FileAudio className="w-10 h-10 text-muted-foreground p-2" />
      )}
      <div className="flex-1 min-w-0">
        <p className="font-medium text-foreground truncate">{source.name}</p>
        {source.artists && (
          <p className="text-sm text-muted-foreground truncate">{source.artists.join(', ')}</p>
        )}
        {showOwner && (
          <p className="text-xs text-muted-foreground truncate">
            {source.profile?.username || 'Anonymous'}
            {signalCounts[source.id] ? ` • ${signalCounts[source.id]} identifiers` : ''}
          </p>
        )}
      </div>
      <Badge variant="outline" className="text-xs">
        {source.source_type}
      </Badge>
    </div>
  );
}
