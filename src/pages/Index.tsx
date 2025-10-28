import { useState } from "react";
import { AudioUploader } from "@/components/AudioUploader";
import { AnalysisResults } from "@/components/AnalysisResults";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Sparkles, FileAudio, Network, ListTree } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import heroBackground from "@/assets/hero-background.jpg";
import { NetworkVisualization } from "@/components/NetworkVisualization";
import { Badge } from "@/components/ui/badge";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Check, X } from "lucide-react";

const Index = () => {
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [spotifyTracks, setSpotifyTracks] = useState<any[]>([]);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [results, setResults] = useState<{ sources: any[]; images: any[] } | null>(null);
  const [selectedSources, setSelectedSources] = useState<string[]>([]);
  const [open, setOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<string>("select");

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

    try {
      // Prepare sources for backend analysis
      const sources = [
        ...selectedFiles.map(f => ({ name: f.name, type: 'file' as const })),
        ...spotifyTracks.map(t => ({ 
          name: `${t.name} - ${t.artists[0].name}`, 
          type: 'track' as const 
        }))
      ];

      console.log('Sending sources for analysis:', sources);

      // Call backend AI analysis
      const { data, error } = await supabase.functions.invoke('analyze-audio', {
        body: { sources }
      });

      if (error) {
        console.error('Analysis error:', error);
        throw new Error(error.message || 'Analysis failed');
      }

      // Check if backend returned an error in the response
      if (data?.error) {
        console.error('Backend error:', data.error);
        throw new Error(data.error);
      }

      if (!data || !data.sources) {
        console.error('Invalid response structure:', data);
        throw new Error('Invalid analysis response - no sources returned. Please try again.');
      }

      console.log('Received analysis:', data);

      // Map backend results (per-source structure)
      const resultsWithIcons = data.sources;

      // Collect images from Spotify tracks for visualization
      const imageData = spotifyTracks
        .filter(track => track.album.images && track.album.images.length > 0)
        .map(track => ({
          name: `${track.name} - ${track.artists[0].name}`,
          imageUrl: track.album.images[0].url
        }));

      setResults({ sources: resultsWithIcons, images: imageData });
      setIsAnalyzing(false);
      setActiveTab("network"); // Switch to network tab after analysis
      toast.success(`Comparative semantic analysis complete for ${totalItems} source${totalItems > 1 ? 's' : ''}!`);
    } catch (error) {
      console.error('Analysis error:', error);
      setIsAnalyzing(false);
      toast.error(error instanceof Error ? error.message : 'Analysis failed. Please try again.');
    }
  };

  // Filter sources based on selection
  const filteredSources = selectedSources.length === 0
    ? results?.sources || []
    : (results?.sources || []).filter((source: any) => {
        const cleanSourceName = source.name.trim();
        return selectedSources.some(selected => selected.trim() === cleanSourceName);
      });

  const filteredImages = selectedSources.length === 0
    ? results?.images || []
    : (results?.images || []).filter((img: any) => 
        selectedSources.some(selected => selected.trim() === img.name.trim())
      );

  const toggleSource = (sourceName: string) => {
    setSelectedSources(prev =>
      prev.includes(sourceName)
        ? prev.filter(s => s !== sourceName)
        : [...prev, sourceName]
    );
  };

  const clearAllFilters = () => {
    setSelectedSources([]);
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
              Semantic Ontological Network, extracting audio-based encoders and audio-text modalities to show categorical relationships
            </p>
          </div>
        </div>
      </div>

      {/* Main Content with Tabs */}
      <div className="mx-auto max-w-7xl px-6 py-12">
        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList className="grid w-full grid-cols-3 mb-8">
            <TabsTrigger value="select" className="flex items-center gap-2">
              <FileAudio className="h-4 w-4" />
              Select Audio Sources
            </TabsTrigger>
            <TabsTrigger value="network" className="flex items-center gap-2" disabled={!results}>
              <Network className="h-4 w-4" />
              Ontological Identity Network
            </TabsTrigger>
            <TabsTrigger value="analysis" className="flex items-center gap-2" disabled={!results}>
              <ListTree className="h-4 w-4" />
              Per-Source Semantic Analysis
            </TabsTrigger>
          </TabsList>

          {/* Tab 1: Select Audio Sources */}
          <TabsContent value="select" className="space-y-8">
            <div className="flex justify-between items-start mb-6">
              <h2 className="text-2xl font-bold text-foreground">
                Select Audio Sources
                {totalItems > 0 && <span className="text-primary ml-2">({totalItems} selected)</span>}
              </h2>
              
              {totalItems > 0 && (
                <Button
                  size="lg"
                  className="gradient-primary shadow-elegant"
                  onClick={handleAnalyze}
                  disabled={isAnalyzing}
                >
                  <Sparkles className="mr-2 h-5 w-5" />
                  {isAnalyzing ? "Analyzing..." : `Analyze ${totalItems} Source${totalItems > 1 ? 's' : ''}`}
                </Button>
              )}
            </div>

            <div className="space-y-4">
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
              </div>
            )}

            {/* Loading State */}
            {isAnalyzing && (
              <Card className="p-8 shadow-elegant">
                <div className="space-y-4 text-center">
                  <div className="flex justify-center">
                    <div className="h-16 w-16 animate-spin rounded-full border-4 border-primary border-t-transparent"></div>
                  </div>
                  <p className="text-lg font-semibold text-foreground">Processing semantic embeddings...</p>
                  <p className="text-sm text-muted-foreground">
                    Extracting features via hierarchical transformer and aligning modalities
                  </p>
                </div>
              </Card>
            )}
          </TabsContent>

          {/* Tab 2: Ontological Identity Network */}
          <TabsContent value="network" className="space-y-6">
            {/* Filter Controls */}
            {results && results.sources.length > 1 && (
              <Card className="p-4 bg-card/80 backdrop-blur-sm shadow-elegant border-border/50">
                <div className="flex items-center gap-4 flex-wrap">
                  <label className="text-sm font-semibold text-foreground whitespace-nowrap">
                    Filter by Source:
                  </label>
                  <Popover open={open} onOpenChange={setOpen}>
                    <PopoverTrigger asChild>
                      <Button
                        variant="outline"
                        role="combobox"
                        aria-expanded={open}
                        className="w-[300px] justify-between bg-background border-border"
                      >
                        {selectedSources.length === 0
                          ? `All Sources (${results.sources.length})`
                          : `${selectedSources.length} selected`}
                        <Check className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-[300px] p-0 bg-background border-border z-50">
                      <Command className="bg-background">
                        <CommandInput placeholder="Search sources..." className="h-9" />
                        <CommandEmpty>No source found.</CommandEmpty>
                        <CommandGroup className="max-h-64 overflow-auto">
                          {results.sources.map((source: any) => (
                            <CommandItem
                              key={source.name}
                              value={source.name}
                              onSelect={() => toggleSource(source.name)}
                              className="cursor-pointer"
                            >
                              <Check
                                className={`mr-2 h-4 w-4 ${
                                  selectedSources.includes(source.name) ? "opacity-100" : "opacity-0"
                                }`}
                              />
                              <span className="truncate">
                                {source.name.length > 35 ? source.name.substring(0, 35) + '...' : source.name}
                              </span>
                            </CommandItem>
                          ))}
                        </CommandGroup>
                      </Command>
                    </PopoverContent>
                  </Popover>
                  {selectedSources.length > 0 && (
                    <>
                      <div className="flex flex-wrap gap-2">
                        {selectedSources.map((sourceName) => (
                          <Badge key={sourceName} variant="secondary" className="gap-1">
                            {sourceName.length > 20 ? sourceName.substring(0, 20) + '...' : sourceName}
                            <X
                              className="h-3 w-3 cursor-pointer hover:text-destructive"
                              onClick={() => toggleSource(sourceName)}
                            />
                          </Badge>
                        ))}
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={clearAllFilters}
                        className="text-xs"
                      >
                        Clear All
                      </Button>
                    </>
                  )}
                </div>
              </Card>
            )}

            <NetworkVisualization sources={filteredSources} sourceImages={filteredImages} />
          </TabsContent>

          {/* Tab 3: Per-Source Semantic Analysis */}
          <TabsContent value="analysis" className="space-y-6">
            {/* Filter Controls */}
            {results && results.sources.length > 1 && (
              <Card className="p-4 bg-card/80 backdrop-blur-sm shadow-elegant border-border/50">
                <div className="flex items-center gap-4 flex-wrap">
                  <label className="text-sm font-semibold text-foreground whitespace-nowrap">
                    Filter by Source:
                  </label>
                  <Popover open={open} onOpenChange={setOpen}>
                    <PopoverTrigger asChild>
                      <Button
                        variant="outline"
                        role="combobox"
                        aria-expanded={open}
                        className="w-[300px] justify-between bg-background border-border"
                      >
                        {selectedSources.length === 0
                          ? `All Sources (${results.sources.length})`
                          : `${selectedSources.length} selected`}
                        <Check className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-[300px] p-0 bg-background border-border z-50">
                      <Command className="bg-background">
                        <CommandInput placeholder="Search sources..." className="h-9" />
                        <CommandEmpty>No source found.</CommandEmpty>
                        <CommandGroup className="max-h-64 overflow-auto">
                          {results.sources.map((source: any) => (
                            <CommandItem
                              key={source.name}
                              value={source.name}
                              onSelect={() => toggleSource(source.name)}
                              className="cursor-pointer"
                            >
                              <Check
                                className={`mr-2 h-4 w-4 ${
                                  selectedSources.includes(source.name) ? "opacity-100" : "opacity-0"
                                }`}
                              />
                              <span className="truncate">
                                {source.name.length > 35 ? source.name.substring(0, 35) + '...' : source.name}
                              </span>
                            </CommandItem>
                          ))}
                        </CommandGroup>
                      </Command>
                    </PopoverContent>
                  </Popover>
                  {selectedSources.length > 0 && (
                    <>
                      <div className="flex flex-wrap gap-2">
                        {selectedSources.map((sourceName) => (
                          <Badge key={sourceName} variant="secondary" className="gap-1">
                            {sourceName.length > 20 ? sourceName.substring(0, 20) + '...' : sourceName}
                            <X
                              className="h-3 w-3 cursor-pointer hover:text-destructive"
                              onClick={() => toggleSource(sourceName)}
                            />
                          </Badge>
                        ))}
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={clearAllFilters}
                        className="text-xs"
                      >
                        Clear All
                      </Button>
                    </>
                  )}
                </div>
              </Card>
            )}

            <AnalysisResults 
              results={filteredSources}
              isAnalyzing={false}
              sourceImages={filteredImages}
            />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
};

export default Index;
