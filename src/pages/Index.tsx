import { useState } from "react";
import { AudioUploader } from "@/components/AudioUploader";
import { AnalysisResults, getCategoryIcon } from "@/components/AnalysisResults";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Sparkles, FileAudio } from "lucide-react";
import { toast } from "sonner";
import heroBackground from "@/assets/hero-background.jpg";

const Index = () => {
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [spotifyTracks, setSpotifyTracks] = useState<any[]>([]);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [results, setResults] = useState<any[] | null>(null);

  const handleFileSelect = (file: File) => {
    setSelectedFiles(prev => [...prev, file]);
    toast.success(`Added: ${file.name}`);
  };

  const handleSpotifyTrack = (track: any) => {
    if (spotifyTracks.find(t => t.id === track.id)) {
      toast.info("Track already added");
      return;
    }
    setSpotifyTracks(prev => [...prev, track]);
    toast.success(`Added: ${track.name} by ${track.artists.map((a: any) => a.name).join(", ")}`);
  };

  const removeFile = (index: number) => {
    setSelectedFiles(prev => prev.filter((_, i) => i !== index));
  };

  const removeTrack = (id: string) => {
    setSpotifyTracks(prev => prev.filter(t => t.id !== id));
  };

  const totalItems = selectedFiles.length + spotifyTracks.length;

  const handleAnalyze = async () => {
    if (totalItems === 0) {
      toast.error("Please select at least one audio file or Spotify track");
      return;
    }

    setIsAnalyzing(true);
    setResults(null);

    // Simulate multi-item ontological analysis
    setTimeout(() => {
      const allSources = [
        ...selectedFiles.map(f => ({ name: f.name, type: 'file' })),
        ...spotifyTracks.map(t => ({ name: `${t.name} - ${t.artists[0].name}`, type: 'track' }))
      ];

      // Generate analysis results that show relationships between multiple sources
      const mockResults = [
        {
          name: "Emotional Expression",
          confidence: 85 + Math.random() * 10,
          description: `Cross-analysis of ${totalItems} source${totalItems > 1 ? 's' : ''} reveals consistent emotional patterns with tonal variations`,
          icon: getCategoryIcon("emotional"),
          sources: allSources.slice(0, Math.min(3, allSources.length))
        },
        {
          name: "Cognitive Patterns",
          confidence: 72 + Math.random() * 15,
          description: `Detected ${totalItems > 1 ? 'interconnected' : 'individual'} linguistic structures and reasoning patterns`,
          icon: getCategoryIcon("cognitive"),
          sources: allSources.slice(0, Math.min(2, allSources.length))
        },
        {
          name: "Social Communication",
          confidence: 78 + Math.random() * 12,
          description: `${totalItems > 1 ? 'Comparative' : 'Individual'} analysis shows social interaction cues and conversational dynamics`,
          icon: getCategoryIcon("social"),
          sources: allSources
        },
        {
          name: "Artistic Elements",
          confidence: 68 + Math.random() * 18,
          description: `Musical and rhythmic qualities ${totalItems > 1 ? 'vary across sources' : 'suggest creative expression'}`,
          icon: getCategoryIcon("artistic"),
          sources: allSources.slice(0, Math.min(4, allSources.length))
        },
        ...(totalItems > 1 ? [{
          name: "Ontological Similarity",
          confidence: 70 + Math.random() * 20,
          description: `Network analysis reveals ${Math.round(65 + Math.random() * 25)}% categorical overlap across selected sources`,
          icon: getCategoryIcon("cognitive"),
          sources: allSources
        }] : [])
      ];

      setResults(mockResults.map(r => ({ ...r, confidence: Math.round(r.confidence) })));
      setIsAnalyzing(false);
      toast.success(`Analysis complete for ${totalItems} source${totalItems > 1 ? 's' : ''}!`);
    }, 3000 + totalItems * 500);
  };

  return (
    <div className="min-h-screen">
      {/* Hero Section */}
      <div className="relative overflow-hidden border-b border-border">
        <div 
          className="absolute inset-0 opacity-20"
          style={{
            backgroundImage: `url(${heroBackground})`,
            backgroundSize: "cover",
            backgroundPosition: "center",
          }}
        />
        <div className="absolute inset-0 bg-gradient-to-b from-background/95 to-background" />
        
        <div className="relative mx-auto max-w-7xl px-6 py-16 sm:py-24">
          <div className="text-center space-y-6">
            <h1 className="text-5xl sm:text-6xl font-bold text-foreground">
              <span className="text-primary">[S]</span>onic{" "}
              <span className="text-primary">[A]</span>ssignment{" "}
              <span className="text-primary">[M]</span>achine
            </h1>
            <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
              Multi-source ontological analysis to visualize connections between audio patterns
              and human characteristics using AI-powered classification
            </p>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="mx-auto max-w-5xl px-6 py-12 space-y-8">
        {/* Upload Section */}
        <div className="space-y-4">
          <h2 className="text-2xl font-bold text-foreground">
            Select Audio Sources
            {totalItems > 0 && <span className="text-primary ml-2">({totalItems} selected)</span>}
          </h2>
          <AudioUploader 
            onFileSelect={handleFileSelect} 
            selectedFile={null}
            onSpotifyTrack={handleSpotifyTrack}
          />
        </div>
        
        {/* Selected Sources Display */}
        {totalItems > 0 && (
          <div className="space-y-4">
            <h2 className="text-2xl font-bold text-foreground">Selected Sources</h2>
            <div className="grid gap-4 md:grid-cols-2">
              {selectedFiles.map((file, index) => (
                <Card key={`file-${index}`} className="p-4">
                  <div className="flex gap-3 items-start">
                    <FileAudio className="h-12 w-12 text-primary flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <h3 className="font-semibold text-foreground truncate">{file.name}</h3>
                      <p className="text-sm text-muted-foreground">
                        {(file.size / 1024 / 1024).toFixed(2)} MB
                      </p>
                    </div>
                    <Button 
                      variant="ghost" 
                      size="sm"
                      onClick={() => removeFile(index)}
                    >
                      Remove
                    </Button>
                  </div>
                </Card>
              ))}
              
              {spotifyTracks.map((track) => (
                <Card key={track.id} className="p-4">
                  <div className="flex gap-3 items-start">
                    {track.album.images[0] && (
                      <img
                        src={track.album.images[0].url}
                        alt={track.album.name}
                        className="w-12 h-12 rounded flex-shrink-0"
                      />
                    )}
                    <div className="flex-1 min-w-0">
                      <h3 className="font-semibold text-foreground truncate">{track.name}</h3>
                      <p className="text-sm text-muted-foreground truncate">
                        {track.artists.map((a: any) => a.name).join(", ")}
                      </p>
                      <p className="text-xs text-muted-foreground truncate">{track.album.name}</p>
                    </div>
                    <Button 
                      variant="ghost" 
                      size="sm"
                      onClick={() => removeTrack(track.id)}
                    >
                      Remove
                    </Button>
                  </div>
                </Card>
              ))}
            </div>

            <Button
              size="lg"
              className="gradient-primary shadow-elegant w-full sm:w-auto"
              onClick={handleAnalyze}
              disabled={isAnalyzing}
            >
              <Sparkles className="mr-2 h-5 w-5" />
              {isAnalyzing ? "Analyzing..." : `Analyze ${totalItems} Source${totalItems > 1 ? 's' : ''}`}
            </Button>
          </div>
        )}

        {/* Results Section */}
        {(results || isAnalyzing) && (
          <div className="space-y-4">
            <h2 className="text-2xl font-bold text-foreground">Results</h2>
            <AnalysisResults results={results} isAnalyzing={isAnalyzing} />
          </div>
        )}
      </div>
    </div>
  );
};

export default Index;
