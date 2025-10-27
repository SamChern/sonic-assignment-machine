import { useState, useCallback } from "react";
import { Upload, FileAudio } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SpotifySearch } from "./SpotifySearch";

interface AudioUploaderProps {
  onFileSelect: (file: File) => void;
  selectedFile: File | null;
  onSpotifyTrack?: (track: any) => void;
}

export const AudioUploader = ({ onFileSelect, selectedFile, onSpotifyTrack }: AudioUploaderProps) => {
  const [isDragging, setIsDragging] = useState(false);

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
      <TabsList className="grid w-full grid-cols-2">
        <TabsTrigger value="upload">Upload File</TabsTrigger>
        <TabsTrigger value="spotify">Spotify Search</TabsTrigger>
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
      
      <TabsContent value="spotify">
        <Card className="p-6">
          <SpotifySearch onTrackSelect={onSpotifyTrack || (() => {})} />
        </Card>
      </TabsContent>
    </Tabs>
  );
};
