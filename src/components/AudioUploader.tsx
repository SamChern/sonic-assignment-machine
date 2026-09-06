import { useEffect, useState, useCallback } from "react";
import { Upload, FileAudio, Library, Globe } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SpotifySearch } from "./SpotifySearch";
import { AppleMusicSearch } from "./AppleMusicSearch";
import { UserLibrary } from "./UserLibrary";
import { AudioSource } from "@/hooks/useAudioSources";
import { useConfiguredIntegrations } from "@/hooks/useConfiguredIntegrations";

interface AudioUploaderProps {
  onFileSelect: (file: File) => void;
  selectedFile: File | null;
  onSpotifyTrack?: (track: any) => void;
  onLibrarySelect?: (sources: AudioSource[]) => void;
  /** Signed-out visitors get one-line guidance under each choice. */
  showHints?: boolean;
}

export const AudioUploader = ({ onFileSelect, selectedFile, onSpotifyTrack, onLibrarySelect, showHints = false }: AudioUploaderProps) => {
  const [isDragging, setIsDragging] = useState(false);
  const { providers, loading: providersLoading } = useConfiguredIntegrations();
  const [selectedProvider, setSelectedProvider] = useState<string | null>(null);

  // Auto-select the first available provider once they load.
  useEffect(() => {
    if (!selectedProvider && providers.length > 0) {
      setSelectedProvider(providers[0].id);
    }
  }, [providers, selectedProvider]);


  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith("audio/")) {
      onFileSelect(file);
    }
  }, [onFileSelect]);

  const handleFileInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      onFileSelect(file);
    }
  }, [onFileSelect]);

  return (
    <Tabs defaultValue="upload" className="w-full">
      <TabsList className="grid w-full grid-cols-3">
        <TabsTrigger value="upload">Upload File</TabsTrigger>
        <TabsTrigger value="external">
          <Globe className="h-4 w-4 mr-1.5" />
          External Search
        </TabsTrigger>
        <TabsTrigger value="library">
          <Library className="h-4 w-4 mr-1.5" />
          Browse Library
        </TabsTrigger>
      </TabsList>
      
      <TabsContent value="upload">
        <Card 
          className={`relative overflow-hidden border-2 transition-smooth ${
            isDragging 
              ? "border-primary bg-primary/5 shadow-glow" 
              : "border-dashed border-muted-foreground/30 hover:border-primary/50"
          }`}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          <div className="p-12 text-center">
            {selectedFile ? (
              <div className="space-y-4">
                <div className="flex items-center justify-center">
                  <FileAudio className="h-16 w-16 text-primary" />
                </div>
                <div>
                  <p className="text-lg font-semibold text-foreground">{selectedFile.name}</p>
                  <p className="text-sm text-muted-foreground">
                    {(selectedFile.size / 1024 / 1024).toFixed(2)} MB
                  </p>
                </div>
                <Button
                  variant="outline"
                  onClick={() => document.getElementById("audio-input")?.click()}
                >
                  Change File
                </Button>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="flex items-center justify-center">
                  <Upload className="h-16 w-16 text-muted-foreground" />
                </div>
                <div>
                  <p className="text-lg font-semibold text-foreground">
                    Drop your audio file here
                  </p>
                  <p className="text-sm text-muted-foreground">
                    or click to browse
                  </p>
                </div>
                <Button
                  className="gradient-primary shadow-elegant"
                  onClick={() => document.getElementById("audio-input")?.click()}
                >
                  Select Audio File
                </Button>
              </div>
            )}
            <input
              id="audio-input"
              type="file"
              accept="audio/*"
              className="hidden"
              onChange={handleFileInput}
            />
          </div>
        </Card>
      </TabsContent>
      
      <TabsContent value="external">
        <Card className="p-6 space-y-4">
          {providersLoading ? (
            <p className="text-sm text-muted-foreground">Loading available services…</p>
          ) : providers.length === 0 ? (
            <div className="text-center py-8 space-y-2">
              <Globe className="h-10 w-10 mx-auto text-muted-foreground" />
              <p className="text-sm font-medium text-foreground">
                No external services configured
              </p>
              <p className="text-xs text-muted-foreground max-w-sm mx-auto">
                An admin can enable Apple Music, Spotify, or other providers in
                the API Integrations dashboard.
              </p>
            </div>
          ) : (
            <>
              <div className="flex items-center gap-3">
                <span className="text-sm font-medium text-foreground whitespace-nowrap">
                  Search service:
                </span>
                <Select
                  value={selectedProvider ?? undefined}
                  onValueChange={setSelectedProvider}
                >
                  <SelectTrigger className="w-[240px]">
                    <SelectValue placeholder="Choose a service" />
                  </SelectTrigger>
                  <SelectContent>
                    {providers.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {selectedProvider === "spotify" && (
                <SpotifySearch onTrackSelect={onSpotifyTrack || (() => {})} />
              )}
              {selectedProvider === "apple_music" && (
                <AppleMusicSearch onTrackSelect={onSpotifyTrack || (() => {})} />
              )}
            </>
          )}
        </Card>
      </TabsContent>

      <TabsContent value="library">
        <Card className="p-6">
          <UserLibrary onSelectMultiple={onLibrarySelect} />
        </Card>
      </TabsContent>
    </Tabs>
  );
};
