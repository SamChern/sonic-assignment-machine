import { AudioUploader } from "@/components/AudioUploader";
import { AudioJobsPanel } from "@/components/AudioJobsPanel";
import { UploadProgressPanel } from "@/components/UploadProgressPanel";
import SonicSimPanel, { type SonicSimSubject } from "@/components/visuals/SonicSimPanel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ChevronDown, ChevronUp, FileAudio, Library, Save, Sparkles, X } from "lucide-react";
import { useUiPreference } from "@/hooks/useUiPreference";
import type { AudioSource } from "@/hooks/useAudioSources";
import type { UploadProgressStatus } from "@/components/UploadProgressPanel";

/**
 * Listen — the first of the three consumer moments: choose or upload sound, then
 * watch the Semantic Scope interpret it. Picking sources and hearing what the
 * model hears belong on the same screen; they used to be two tabs apart.
 */
export const ListenTab = ({
  isSignedIn,
  selectedFiles,
  spotifyTracks,
  librarySources,
  totalItems,
  isAnalyzing,
  analysisProgress,
  scopeSubjects,
  onFileSelect,
  onSpotifyTrack,
  onLibrarySelect,
  onRemoveFile,
  onRemoveTrack,
  onRemoveLibrarySource,
  onClearAll,
  onAnalyze,
  onScopeSubjectChange,
}: {
  isSignedIn: boolean;
  selectedFiles: File[];
  spotifyTracks: any[];
  librarySources: AudioSource[];
  totalItems: number;
  isAnalyzing: boolean;
  analysisProgress: { total: number; status: UploadProgressStatus } | null;
  scopeSubjects: SonicSimSubject[];
  onFileSelect: (file: File) => void;
  onSpotifyTrack: (track: any) => void;
  onLibrarySelect: (sources: AudioSource[]) => void;
  onRemoveFile: (index: number) => void;
  onRemoveTrack: (id: string) => void;
  onRemoveLibrarySource: (id: string) => void;
  onClearAll: () => void;
  onAnalyze: () => void;
  onScopeSubjectChange: (subject: SonicSimSubject | null) => void;
}) => {
  const [sourcesExpanded, setSourcesExpanded] = useUiPreference("home.sources.expanded", true);

  return (
    <div className="space-y-8">
      <div className="mb-2 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-xl font-bold text-foreground sm:text-2xl">
            Listen
            {totalItems > 0 && <span className="ml-2 text-primary">({totalItems} selected)</span>}
          </h2>
          {isSignedIn && (
            <p className="mt-1 flex items-center gap-1.5 text-sm text-muted-foreground">
              <Save className="h-3.5 w-3.5 text-primary" />
              <span>Auto-saving selections &amp; fingerprints to your library</span>
            </p>
          )}
        </div>

        {totalItems > 0 && (
          <Button
            size="lg"
            className="gradient-primary shadow-elegant"
            onClick={onAnalyze}
            disabled={isAnalyzing}
          >
            <Sparkles className="mr-2 h-5 w-5" />
            {isAnalyzing
              ? "Analyzing..."
              : `Analyze ${totalItems} source${totalItems > 1 ? "s" : ""}`}
          </Button>
        )}
      </div>

      <div className="space-y-4">
        <AudioUploader
          onFileSelect={onFileSelect}
          selectedFile={null}
          onSpotifyTrack={onSpotifyTrack}
          onLibrarySelect={onLibrarySelect}
        />
        {isSignedIn && <AudioJobsPanel />}
      </div>

      {totalItems > 0 && (
        <Collapsible open={sourcesExpanded} onOpenChange={setSourcesExpanded}>
          <Card className="border-secondary/20 bg-secondary/10 p-3">
            <div className="flex items-center justify-between">
              <CollapsibleTrigger asChild>
                <button className="flex items-center gap-2 text-left">
                  <span className="text-sm font-medium text-foreground">Selected sources</span>
                  <Badge variant="secondary" className="text-xs">
                    {totalItems}
                  </Badge>
                  {sourcesExpanded ? (
                    <ChevronUp className="h-4 w-4 text-muted-foreground" />
                  ) : (
                    <ChevronDown className="h-4 w-4 text-muted-foreground" />
                  )}
                </button>
              </CollapsibleTrigger>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-2 text-xs text-muted-foreground hover:text-destructive"
                onClick={onClearAll}
              >
                Clear all
              </Button>
            </div>

            <CollapsibleContent className="mt-3">
              <div className="flex flex-wrap gap-2">
                {selectedFiles.map((file, index) => (
                  <Badge
                    key={`file-${index}`}
                    variant="outline"
                    className="gap-1.5 bg-secondary/20 px-2 py-1"
                  >
                    <FileAudio className="h-3 w-3 text-primary" />
                    <span className="max-w-[120px] truncate text-xs">{file.name}</span>
                    <button
                      onClick={() => onRemoveFile(index)}
                      aria-label={`Remove ${file.name}`}
                      className="ml-1 hover:text-destructive"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </Badge>
                ))}

                {librarySources.map((source) => (
                  <Badge
                    key={`lib-${source.id}`}
                    variant="outline"
                    className="gap-1.5 bg-secondary/20 px-2 py-1"
                  >
                    {source.album_image ? (
                      <img
                        src={source.album_image}
                        alt=""
                        className="h-4 w-4 rounded"
                        loading="lazy"
                      />
                    ) : (
                      <Library className="h-3 w-3 text-primary" />
                    )}
                    <span className="max-w-[140px] truncate text-xs">{source.name}</span>
                    <button
                      onClick={() => onRemoveLibrarySource(source.id)}
                      aria-label={`Remove ${source.name}`}
                      className="ml-1 hover:text-destructive"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </Badge>
                ))}

                {spotifyTracks.map((track) => (
                  <Badge
                    key={track.id}
                    variant="outline"
                    className="gap-1.5 bg-secondary/20 px-2 py-1"
                  >
                    {track.album?.images?.[0] && (
                      <img
                        src={track.album.images[0].url}
                        alt={track.album.name}
                        className="h-4 w-4 rounded"
                      />
                    )}
                    <span className="max-w-[120px] truncate text-xs">
                      {track.name} - {track.artists?.[0]?.name}
                    </span>
                    <button
                      onClick={() => onRemoveTrack(track.id)}
                      aria-label={`Remove ${track.name}`}
                      className="ml-1 hover:text-destructive"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </Badge>
                ))}
              </div>
            </CollapsibleContent>
          </Card>
        </Collapsible>
      )}

      {isAnalyzing && analysisProgress && (
        <UploadProgressPanel
          status={analysisProgress.status}
          total={analysisProgress.total}
        />
      )}

    </div>
  );
};

export default ListenTab;
