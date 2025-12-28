import { useState } from "react";
import { Link } from "react-router-dom";
import { AudioUploader } from "@/components/AudioUploader";
import { AnalysisResults } from "@/components/AnalysisResults";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Sparkles, FileAudio, Network, ListTree, User, LogOut, Library, Save, Shield, Activity, ChevronDown, ChevronUp } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import heroBackground from "@/assets/hero-background.jpg";
import exampleOutput from "@/assets/example-output.png";
import secondaryImage from "@/assets/secondary-homepage-image.png";
import { NetworkVisualization } from "@/components/NetworkVisualization";
import { Badge } from "@/components/ui/badge";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Check, X } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useAudioSources, AudioSource } from "@/hooks/useAudioSources";
import { UserLibrary } from "@/components/UserLibrary";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useEC2Api } from "@/hooks/useEC2Api";

const Index = () => {
  const { user, profile, signOut, loading: authLoading, isAdmin } = useAuth();
  const { saveSpotifyTrack, saveFileSource } = useAudioSources();
  const { checkHealth, loading: ec2Loading } = useEC2Api();
  
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [spotifyTracks, setSpotifyTracks] = useState<any[]>([]);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisProgress, setAnalysisProgress] = useState<{
    total: number;
    cached: number;
    fresh: number;
    status: 'idle' | 'checking-cache' | 'analyzing' | 'complete';
  } | null>(null);
  const [results, setResults] = useState<{ sources: any[]; images: any[] } | null>(null);
  const [selectedSources, setSelectedSources] = useState<string[]>([]);
  const [open, setOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<string>("select");
  const [sourcesExpanded, setSourcesExpanded] = useState(true);
  const [showGetStartedDialog, setShowGetStartedDialog] = useState(false);

  const handleGetStarted = () => {
    setShowGetStartedDialog(false);
    setActiveTab("select");
  };

  const handleHealthCheck = async () => {
    const result = await checkHealth();
    if (result.error) {
      toast.error(`EC2 Connection Failed: ${result.error}`);
    } else {
      toast.success(`EC2 Connected! Status: ${result.data?.status || 'OK'}`);
    }
  };

  const handleFileSelect = (file: File) => {
    setSelectedFiles(prev => [...prev, file]);
    toast.success(`Added: ${file.name}`);
    // Optionally save to library
    if (user) {
      saveFileSource(file);
    }
  };

  const handleSpotifyTrack = (track: any) => {
    if (spotifyTracks.find(t => t.id === track.id)) {
      toast.info("Track already added");
      return;
    }
    setSpotifyTracks(prev => [...prev, track]);
    toast.success(`Added: ${track.name} by ${track.artists.map((a: any) => a.name).join(", ")}`);
    // Optionally save to library
    if (user) {
      saveSpotifyTrack(track);
    }
  };

  const handleLibrarySelect = (sources: AudioSource[]) => {
    sources.forEach(source => {
      if (source.source_type === 'spotify') {
        // Convert to track format for analysis
        const mockTrack = {
          id: source.spotify_id || source.id,
          name: source.name.split(' - ')[0],
          artists: (source.artists || []).map(name => ({ name })),
          album: {
            name: source.album_name || '',
            images: source.album_image ? [{ url: source.album_image }] : [],
          },
          external_urls: { spotify: source.spotify_url },
          preview_url: source.preview_url,
        };
        if (!spotifyTracks.find(t => t.id === mockTrack.id)) {
          setSpotifyTracks(prev => [...prev, mockTrack]);
        }
      }
    });
    toast.success(`Added ${sources.length} source(s) to analysis`);
    setActiveTab("select");
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
    setAnalysisProgress({
      total: totalItems,
      cached: 0,
      fresh: 0,
      status: 'checking-cache',
    });

    // Prepare sources for backend analysis (include spotify_id for caching)
    const sources = [
      ...selectedFiles.map(f => ({ name: f.name, type: 'file' as const })),
      ...spotifyTracks.map(t => ({
        name: `${t.name} - ${t.artists[0].name}`,
        type: 'track' as const,
        spotify_id: t.id, // Enable cache lookup by Spotify ID
      }))
    ];

    const invokeAnalysis = async () => {
      const { data, error } = await supabase.functions.invoke('analyze-audio', {
        body: {
          sources,
          user_id: user?.id,
          save_results: !!user,
        }
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

      return data;
    };

    try {
      console.log('Sending sources for analysis:', sources);

      // Update to analyzing status
      setAnalysisProgress(prev => prev ? { ...prev, status: 'analyzing' } : null);

      let data;
      try {
        data = await invokeAnalysis();
      } catch (firstError) {
        // Retry once if the error looks like the JSON-parse issue
        const errMsg = firstError instanceof Error ? firstError.message : String(firstError);
        if (errMsg.includes('Failed to parse AI response')) {
          toast.info('AI response was malformed — retrying automatically…');
          data = await invokeAnalysis();
        } else {
          throw firstError;
        }
      }

      console.log('Received analysis:', data);

      // Update progress with cache stats from response
      const cacheStats = data.cache_stats || { cached: 0, fresh: data.sources?.length || 0 };
      setAnalysisProgress({
        total: totalItems,
        cached: cacheStats.cached,
        fresh: cacheStats.fresh,
        status: 'complete',
      });

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
      
      // Show detailed success message
      const cachedMsg = cacheStats.cached > 0 ? ` (${cacheStats.cached} cached, ${cacheStats.fresh} analyzed)` : '';
      toast.success(`Semantic analysis complete for ${totalItems} source${totalItems > 1 ? 's' : ''}${cachedMsg}!`);
    } catch (error) {
      console.error('Analysis error:', error);
      setIsAnalyzing(false);
      setAnalysisProgress(null);
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
        
        {/* Auth Controls */}
        <div className="absolute top-4 right-4 z-10 flex items-center gap-3">
          {/* EC2 Health Check Button - Admin Only */}
          {isAdmin && (
            <Button 
              variant="outline" 
              size="sm" 
              className="gap-2 border-green-500/50 text-green-500 hover:bg-green-500/10"
              onClick={handleHealthCheck}
              disabled={ec2Loading}
            >
              <Activity className={`h-4 w-4 ${ec2Loading ? 'animate-pulse' : ''}`} />
              <span className="hidden sm:inline">{ec2Loading ? 'Checking...' : 'EC2 Health'}</span>
            </Button>
          )}
          
          {authLoading ? (
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          ) : user ? (
            <div className="flex items-center gap-3">
              {isAdmin && (
                <Link to="/admin">
                  <Button variant="outline" size="sm" className="gap-2 border-primary/50 text-primary">
                    <Shield className="h-4 w-4" />
                    <span className="hidden sm:inline">Admin</span>
                  </Button>
                </Link>
              )}
              <Avatar className="h-8 w-8">
                <AvatarImage src={profile?.avatar_url || undefined} />
                <AvatarFallback>
                  <User className="h-4 w-4" />
                </AvatarFallback>
              </Avatar>
              <span className="text-sm text-foreground font-medium hidden sm:inline">
                {profile?.username || user.email?.split('@')[0]}
              </span>
              <Button variant="ghost" size="sm" onClick={signOut}>
                <LogOut className="h-4 w-4" />
              </Button>
            </div>
          ) : (
            <Link to="/auth">
              <Button variant="outline" size="sm" className="gap-2">
                <User className="h-4 w-4" />
                Sign In
              </Button>
            </Link>
          )}
        </div>
        
        <div className="relative mx-auto max-w-7xl px-6 py-8 sm:py-12">
          <div className="text-center space-y-4">
            <h1 className="text-4xl sm:text-5xl font-bold text-foreground">
              <span className="text-primary">[S]</span>onic{" "}
              <span className="text-primary">[A]</span>ssignment{" "}
              <span className="text-primary">[M]</span>achine
            </h1>
          </div>
          
          {/* Example Output Preview */}
          <div className="mt-8 flex justify-center gap-8">
            {/* Main glowing image - positioned left */}
            <div className="relative rounded-3xl max-w-md animate-glow-pulse animate-float flex-shrink-0" style={{ marginLeft: '-45%' }}>
              <div className="rounded-3xl overflow-hidden" style={{ maskImage: 'linear-gradient(to bottom, black 35%, transparent 100%)', WebkitMaskImage: 'linear-gradient(to bottom, black 35%, transparent 100%)' }}>
                <img 
                  src={exampleOutput} 
                  alt="Example sonic fingerprint network visualization" 
                  className="w-full h-auto"
                  style={{ transform: 'scale(1.35)' }}
                />
              </div>
              {/* Subtitle embedded at top */}
              <div className="absolute top-4 left-4 right-4 z-10">
                <p className="text-xl sm:text-2xl text-foreground text-center bg-background/25 backdrop-blur-md py-2 px-4 rounded-xl shadow-lg">
                  Use advanced multi-modal AI to create your own sonic fingerprint and compare it with others.
                </p>
              </div>
              {/* CTA Button embedded at bottom */}
              <div className="absolute bottom-8 left-1/2 -translate-x-1/2 z-10">
                <Button 
                  size="lg" 
                  className="shadow-xl"
                  onClick={() => setShowGetStartedDialog(true)}
                >
                  <Sparkles className="mr-2 h-5 w-5" />
                  Get Started
                </Button>
              </div>
            </div>
            
            {/* Secondary radar chart image on the right */}
            <div className="relative max-w-xs flex-shrink-0 animate-float" style={{ animationDelay: '1s' }}>
              <img 
                src={secondaryImage} 
                alt="Sonic fingerprint radar visualization" 
                className="w-full h-auto rounded-2xl opacity-90"
              />
            </div>
          </div>
        </div>
      </div>

      {/* Main Content with Tabs */}
      <div className="mx-auto max-w-7xl px-6 py-12">
        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList className="grid w-full grid-cols-4 mb-8">
            <TabsTrigger value="select" className="flex items-center gap-2">
              <FileAudio className="h-4 w-4" />
              <span className="hidden sm:inline">Select Sources</span>
              <span className="sm:hidden">Sources</span>
            </TabsTrigger>
            <TabsTrigger value="library" className="flex items-center gap-2">
              <Library className="h-4 w-4" />
              <span className="hidden sm:inline">Browse Library</span>
              <span className="sm:hidden">Library</span>
            </TabsTrigger>
            <TabsTrigger value="network" className="flex items-center gap-2" disabled={!results}>
              <Network className="h-4 w-4" />
              <span className="hidden sm:inline">Network</span>
              <span className="sm:hidden">Network</span>
            </TabsTrigger>
            <TabsTrigger value="analysis" className="flex items-center gap-2" disabled={!results}>
              <ListTree className="h-4 w-4" />
              <span className="hidden sm:inline">Analysis</span>
              <span className="sm:hidden">Analysis</span>
            </TabsTrigger>
          </TabsList>

          {/* Tab 1: Select Audio Sources */}
          <TabsContent value="select" className="space-y-8">
            <div className="flex justify-between items-start mb-6">
              <div>
                <h2 className="text-2xl font-bold text-foreground">
                  Select Audio Sources
                  {totalItems > 0 && <span className="text-primary ml-2">({totalItems} selected)</span>}
                </h2>
                {user && (
                  <p className="text-sm text-muted-foreground mt-1 flex items-center gap-1.5">
                    <Save className="h-3.5 w-3.5 text-green-500" />
                    <span>Auto-saving selections & fingerprints to your library</span>
                  </p>
                )}
              </div>
              
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
            
            {/* Selected Sources Display - Compact & Collapsible */}
            {totalItems > 0 && (
              <Collapsible open={sourcesExpanded} onOpenChange={setSourcesExpanded}>
                <Card className="p-3 bg-secondary/10 border-secondary/20">
                  <div className="flex items-center justify-between">
                    <CollapsibleTrigger asChild>
                      <button className="flex items-center gap-2 text-left">
                        <span className="text-sm font-medium text-foreground">Selected Sources</span>
                        <Badge variant="secondary" className="text-xs">{totalItems}</Badge>
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
                      className="text-xs h-6 px-2 text-muted-foreground hover:text-destructive"
                      onClick={() => {
                        setSelectedFiles([]);
                        setSpotifyTracks([]);
                      }}
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
                          className="py-1 px-2 gap-1.5 bg-secondary/20"
                        >
                          <FileAudio className="h-3 w-3 text-primary" />
                          <span className="text-xs max-w-[120px] truncate">{file.name}</span>
                          <button 
                            onClick={() => removeFile(index)}
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
                          className="py-1 px-2 gap-1.5 bg-secondary/20"
                        >
                          {track.album.images[0] && (
                            <img
                              src={track.album.images[0].url}
                              alt={track.album.name}
                              className="w-4 h-4 rounded"
                            />
                          )}
                          <span className="text-xs max-w-[120px] truncate">
                            {track.name} - {track.artists[0]?.name}
                          </span>
                          <button 
                            onClick={() => removeTrack(track.id)}
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

            {/* Loading State with Progress */}
            {isAnalyzing && analysisProgress && (
              <Card className="p-8 shadow-elegant">
                <div className="space-y-4 text-center">
                  <div className="flex justify-center">
                    <div className="h-16 w-16 animate-spin rounded-full border-4 border-primary border-t-transparent"></div>
                  </div>
                  
                  {/* Progress Status */}
                  <div className="space-y-2">
                    <p className="text-lg font-semibold text-foreground">
                      {analysisProgress.status === 'checking-cache' && 'Checking semantic cache...'}
                      {analysisProgress.status === 'analyzing' && 'Running AI semantic analysis...'}
                      {analysisProgress.status === 'complete' && 'Finalizing results...'}
                    </p>
                    
                    {/* Progress indicators */}
                    <div className="flex justify-center gap-4 text-sm">
                      <div className="flex items-center gap-1.5 px-3 py-1.5 bg-secondary/20 rounded-full">
                        <Activity className="h-3.5 w-3.5 text-primary animate-pulse" />
                        <span className="text-muted-foreground">
                          {analysisProgress.total} source{analysisProgress.total !== 1 ? 's' : ''}
                        </span>
                      </div>
                      
                      {analysisProgress.status === 'analyzing' && (
                        <div className="flex items-center gap-1.5 px-3 py-1.5 bg-primary/10 rounded-full">
                          <Sparkles className="h-3.5 w-3.5 text-primary" />
                          <span className="text-primary font-medium">Agent processing...</span>
                        </div>
                      )}
                    </div>
                    
                    <p className="text-xs text-muted-foreground mt-2">
                      {analysisProgress.status === 'checking-cache' && 
                        'Looking up previously analyzed sources to speed up processing...'}
                      {analysisProgress.status === 'analyzing' && 
                        'Extracting semantic features via hierarchical transformer and aligning modalities'}
                    </p>
                  </div>
                </div>
              </Card>
            )}
          </TabsContent>

          {/* Tab 2: Browse Library */}
          <TabsContent value="library" className="space-y-6">
            <div className="flex justify-between items-start mb-6">
              <div>
                <h2 className="text-2xl font-bold text-foreground">Browse Audio Library</h2>
                <p className="text-muted-foreground mt-1">
                  Select sources from your library or browse public collections
                </p>
              </div>
            </div>
            <UserLibrary onSelectMultiple={handleLibrarySelect} />
          </TabsContent>

          {/* Tab 3: Ontological Identity Network */}
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

      {/* Get Started Dialog */}
      <Dialog open={showGetStartedDialog} onOpenChange={setShowGetStartedDialog}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-xl font-bold">Get started with the following steps</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <ol className="list-decimal list-inside space-y-3 text-foreground">
              <li>Upload a user's playlist, audio history or any other sonic identifiers</li>
              <li>Find the connective tissue between a user's sonic history.</li>
              <li>Category sonic history into 6 meta categories.</li>
              <li>Garner insights around sonic similarities and differences.</li>
            </ol>
            
            {/* Enterprise Section */}
            <div className="mt-4 p-4 rounded-lg border border-primary/30 bg-primary/5 relative overflow-hidden">
              <div className="absolute top-0 right-0">
                <Badge className="rounded-none rounded-bl-lg bg-primary text-primary-foreground">
                  Enterprise
                </Badge>
              </div>
              <p className="text-sm text-foreground font-medium mb-2 pr-20">
                Compare sonic fingerprints across users to create a new path to enrich your data-driven marketing, including:
              </p>
              <ol className="list-[lower-alpha] list-inside ml-2 space-y-1 text-sm text-muted-foreground">
                <li>Identity resolution</li>
                <li>Multi-modal clustering</li>
                <li>Contextual targeting</li>
                <li>Predictive analyses</li>
              </ol>
            </div>
          </div>
          <div className="flex justify-end">
            <Button onClick={handleGetStarted}>
              <Sparkles className="mr-2 h-4 w-4" />
              Continue
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default Index;
