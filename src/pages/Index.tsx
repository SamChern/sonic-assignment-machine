import { useState, useEffect, useMemo, useRef } from "react";
import { Link, useSearchParams } from "react-router-dom";
import SonicSimPanel from "@/components/visuals/SonicSimPanel";
import ListenTab from "@/components/home/ListenTab";
import UnderstandTab from "@/components/home/UnderstandTab";
import LibraryTab from "@/components/home/LibraryTab";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Sparkles, FileAudio, Network, ListTree, User, LogOut, Shield, Building2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { invokeWithTimeout } from "@/lib/invokeWithTimeout";
import type { AnalyzeAudioResponse } from "@/lib/analyzeAudio";
import heroBackground from "@/assets/hero-background.jpg";
import exampleOutput from "@/assets/example-output.png";
import secondaryImage from "@/assets/secondary-homepage-image.png";
import sonicSimLogo from "@/assets/SonicSIM_blend.png";

import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/hooks/useAuth";
import { useOrganization } from "@/hooks/useOrganization";
import { useAudioSources, AudioSource } from "@/hooks/useAudioSources";
import { WaveformBackground } from "@/components/WaveformBackground";
import { usePersona } from "@/hooks/usePersona";
import PersonaChooser from "@/components/persona/PersonaChooser";
import DoorSwitcher from "@/components/persona/DoorSwitcher";
import ConsumerDoor from "@/components/home/ConsumerDoor";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useFingerprints } from "@/hooks/useFingerprints";
import { analysisToScores, fingerprintToScores } from "@/lib/audioscope";





import { normalizeTab } from "@/lib/homeTabs";


const Index = () => {
  const { user, profile, signOut, loading: authLoading, isAdmin } = useAuth();
  const { orgs: enterpriseOrgs } = useOrganization();
  const hasEnterprise = enterpriseOrgs.length > 0;
  const { persona, setPersona, ready: personaReady } = usePersona();
  const [personaAsked, setPersonaAsked] = useState(false);


  const { saveSpotifyTrack, saveFileSource } = useAudioSources();
  
  const { myFingerprint, allFingerprints, myAnalyses } = useFingerprints();
  
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
  /** Source name currently playing in "See my SonicSIM" — pulses its ontology nodes. */
  const [sonicSimSubject, setSonicSimSubject] = useState<string | null>(null);
  const [selectedSources, setSelectedSources] = useState<string[]>([]);
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [searchParams, setSearchParams] = useSearchParams();
  const [activeTab, setActiveTab] = useState<string>(
    () => normalizeTab(searchParams.get("tab")),
  );
  const [showGetStartedDialog, setShowGetStartedDialog] = useState(false);
  const logoRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLElement>(null);

  // Keep the tab state and the ?tab= param in sync so the mobile bottom nav
  // can deep-link into a specific tab from any route.
  const urlTab = searchParams.get("tab");
  useEffect(() => {
    if (urlTab) {
      const next = normalizeTab(urlTab);
      if (next !== activeTab) setActiveTab(next);
    }
  }, [urlTab]);

  const handleTabChange = (next: string) => {
    setActiveTab(next);
    const params = new URLSearchParams(searchParams);
    params.set("tab", next);
    setSearchParams(params, { replace: true });
  };



  useEffect(() => {
    const handleScroll = () => {
      const scrollY = window.scrollY;
      const fadeEnd = 280;
      const progress = Math.min(1, Math.max(0, scrollY / fadeEnd));
      if (logoRef.current) {
        logoRef.current.style.setProperty('--logo-opacity', String(1 - progress));
        logoRef.current.style.setProperty('--logo-overlay-opacity', String(progress));
        logoRef.current.style.setProperty('--logo-blur', `${progress * 3}px`);
        logoRef.current.style.setProperty('--logo-scale', String(1 - progress * 0.04));
      }
      if (headerRef.current) {
        headerRef.current.style.setProperty('--header-bg-opacity', String(progress * 0.85));
        headerRef.current.style.setProperty('--header-border-opacity', String(progress * 0.6));
        headerRef.current.style.setProperty('--header-logo-opacity', String(progress));
      }
    };
    window.addEventListener('scroll', handleScroll, { passive: true });
    handleScroll();
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const handleGetStarted = () => {
    setShowGetStartedDialog(false);
    setActiveTab("listen");
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
    setActiveTab("listen");
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
      // Bounded: a hung edge function must fail loudly rather than spin forever.
      const { data, error } = await invokeWithTimeout<AnalyzeAudioResponse>('analyze-audio', {
        body: {
          sources,
          user_id: user?.id,
          save_results: !!user,
        },
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
      setActiveTab("understand"); // Switch to network tab after analysis
      
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

  const toggleCategory = (category: string) => {
    setSelectedCategories(prev =>
      prev.includes(category)
        ? prev.filter(c => c !== category)
        : [...prev, category]
    );
  };

  const clearCategoryFilters = () => {
    setSelectedCategories([]);
  };

  /** Scope subjects: the aggregate fingerprint first, then recent analyses. */
  const scopeSubjects = useMemo(
    () => [
      ...(myFingerprint
        ? [
            {
              id: `fingerprint-${myFingerprint.user_id}`,
              label: "My sonic fingerprint (aggregate)",
              sublabel: `Aggregate · ${myFingerprint.total_sources_analyzed} sources`,
              scores: fingerprintToScores(myFingerprint as never),
            },
          ]
        : []),
      ...(myAnalyses || []).slice(0, 25).map((a) => ({
        id: a.id,
        label: a.source_name,
        sublabel: `Analysis · ${a.source_name}`,
        scores: analysisToScores(a as never),
      })),
    ],
    [myFingerprint, myAnalyses],
  );

  return (
    <div className="min-h-screen">
      {/* Sticky Header */}
      <header
        ref={headerRef}
        className="fixed top-0 left-0 right-0 z-50 px-4 sm:px-6 py-2 sm:py-3 flex items-center justify-between gap-2 backdrop-blur-md border-b transition-all duration-150 ease-out will-change-[background-color,border-color]"
        style={{
          backgroundColor: 'hsl(var(--background) / var(--header-bg-opacity, 0))',
          borderColor: 'hsl(var(--border) / var(--header-border-opacity, 0))',
        }}
      >
        <div className="relative flex items-center">
          <img
            src={sonicSimLogo}
            alt="SonicSIM.ai"
            width={1264}
            height={847}
            decoding="async"
            className="h-6 sm:h-8 md:h-9 w-auto max-w-[45vw] object-contain select-none transition-opacity duration-150 ease-out will-change-opacity"
            style={{ opacity: 'var(--header-logo-opacity, 0)', filter: 'brightness(1.2)' }}
            draggable={false}
          />
        </div>
        
        {/* Auth Controls */}
        <div className="flex items-center gap-1.5 sm:gap-3 shrink-0">
          {/* EC2 Health check lives in the admin dashboard header */}


          
          {authLoading ? (
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          ) : (
            <DoorSwitcher
              persona={persona}
              onSelect={setPersona}
              isSignedIn={!!user}
              isAdmin={isAdmin}
              hasEnterprise={hasEnterprise}
              avatarUrl={profile?.avatar_url}
              displayName={profile?.username || user?.email?.split("@")[0]}
              onSignOut={signOut}
            />
          )}

        </div>
      </header>

      {/* Hero Section */}
      <div className="relative overflow-hidden">
        <div 
          className="absolute inset-0 opacity-85"
          style={{
            backgroundImage: `url(${heroBackground})`,
            backgroundSize: "cover",
            backgroundPosition: "center",
            filter: "grayscale(60%) brightness(0.7)",
          }}
        />
        <div className="absolute inset-0 bg-gradient-to-b from-background/95 to-background" />
        
        <div className="relative mx-auto max-w-7xl px-4 sm:px-6 pt-16 sm:pt-24 pb-8 sm:pb-12">
          <div className="sticky top-14 z-10 text-center sm:top-16" ref={logoRef}>
            <div className="relative inline-block">
              <img
                src={sonicSimLogo}
                alt="SonicSIM.ai"
                width={1264}
                height={847}
                {...{ fetchpriority: "high" }}
                decoding="async"
                className="mx-auto h-[clamp(84px,27vw,211px)] w-auto max-w-full object-contain select-none transition-all duration-75 ease-out will-change-[opacity,transform,filter]"
                style={{
                  aspectRatio: "1264 / 847",
                  opacity: 'var(--logo-opacity, 1)',
                  filter: 'brightness(1.2) blur(var(--logo-blur, 0px))',
                  transform: 'scale(var(--logo-scale, 1))',
                }}
                draggable={false}
              />
              <div
                className="absolute inset-0 bg-background pointer-events-none transition-opacity duration-75 ease-out will-change-opacity"
                style={{ opacity: 'var(--logo-overlay-opacity, 0)' }}
              />
            </div>
          </div>

          
          {/* Example Output Preview */}
          <div className="mt-6 sm:mt-8 flex flex-col md:flex-row justify-center items-center gap-6 md:gap-12">
            {/* Main glowing image */}
            <div className="relative rounded-3xl w-full max-w-sm md:max-w-md animate-float md:flex-shrink-0">
              <div className="rounded-3xl overflow-hidden" style={{ maskImage: 'linear-gradient(to bottom, black 35%, transparent 100%)', WebkitMaskImage: 'linear-gradient(to bottom, black 35%, transparent 100%)' }}>
                <img 
                  src={exampleOutput} 
                  alt="Example sonic fingerprint network visualization" 
                  className="w-full h-auto"
                  style={{ transform: 'scale(1.35)' }}
                />
              </div>
            </div>
            
            {/* Text content */}
            <div className="flex w-full flex-col items-center md:items-start gap-5 sm:gap-6 max-w-md text-center md:text-left">
              <p className="text-[0.9rem] leading-relaxed text-foreground sm:text-[1.2rem]">
                Use advanced multi-modal AI to create your own sonic fingerprint and compare it with others.
              </p>
              <Button 
                size="lg" 
                className="shadow-xl w-full sm:w-auto min-h-12"
                onClick={() => setShowGetStartedDialog(true)}
              >
                <Sparkles className="mr-2 h-5 w-5" />
                Get Started
              </Button>
            </div>
          </div>

        </div>
      </div>

      {/* SCOPE audioscope band — the only visual between the hero and the tabs */}
      <section aria-labelledby="scope-heading" className="mx-auto max-w-7xl px-4 pb-2 pt-4 sm:px-6 sm:pb-4 sm:pt-6">
        <h2 id="scope-heading" className="sr-only">
          SonicSIM SCOPE audioscope
        </h2>
        <SonicSimPanel
          title="SCOPE"
          description="A live audioscope of the six-category semantic layer."
          defaultMode="scope"
          height={200}
          subjects={[
            {
              id: "home-scope",
              label: "SonicSIM SCOPE",
              sublabel: "Six-category semantic waveform",
              scores: {
                emotional: 72,
                cognitive: 58,
                social: 46,
                communication: 64,
                contextual: 55,
                artistic: 68,
              },
            },
          ]}
        />
      </section>

      {/* Step 16a — the Consumer door: one input, one result, one ladder. */}
      {persona !== "marketing" && (
        <div className="mx-auto max-w-4xl px-4 pb-2 pt-6 sm:px-6">
          <ConsumerDoor
            isSignedIn={!!user}
            userId={user?.id ?? null}
            allFingerprints={allFingerprints || []}
          />
        </div>
      )}

      {/* Main content — three consumer moments: Listen, Understand, Library */}

      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 sm:py-12">
        <Tabs value={activeTab} onValueChange={handleTabChange} className="w-full min-w-0">
          <TabsList className="mb-6 grid h-auto min-h-12 w-full max-w-full grid-cols-3 items-stretch gap-1 sm:mb-8">
            <TabsTrigger value="listen" className="flex h-auto min-h-10 min-w-0 items-center justify-center gap-2 px-2 py-2.5 sm:px-3">
              <FileAudio className="h-4 w-4 shrink-0" />
              <span className="truncate">Listen</span>
            </TabsTrigger>
            <TabsTrigger value="understand" className="flex h-auto min-h-10 min-w-0 items-center justify-center gap-2 px-2 py-2.5 sm:px-3">
              <Network className="h-4 w-4 shrink-0" />
              <span className="truncate">Understand</span>
            </TabsTrigger>
            <TabsTrigger value="library" className="flex h-auto min-h-10 min-w-0 items-center justify-center gap-2 px-2 py-2.5 sm:px-3">
              <ListTree className="h-4 w-4 shrink-0" />
              <span className="truncate">Library</span>
            </TabsTrigger>
          </TabsList>

          <TabsContent value="listen">
            <ListenTab
              isSignedIn={!!user}
              selectedFiles={selectedFiles}
              spotifyTracks={spotifyTracks}
              totalItems={totalItems}
              isAnalyzing={isAnalyzing}
              analysisProgress={analysisProgress}
              scopeSubjects={scopeSubjects}
              onFileSelect={handleFileSelect}
              onSpotifyTrack={handleSpotifyTrack}
              onLibrarySelect={handleLibrarySelect}
              onRemoveFile={removeFile}
              onRemoveTrack={removeTrack}
              onClearAll={() => {
                setSelectedFiles([]);
                setSpotifyTracks([]);
              }}
              onAnalyze={handleAnalyze}
              onScopeSubjectChange={(s) =>
                setSonicSimSubject(s && !s.id.startsWith("fingerprint-") ? s.label : null)
              }
            />
          </TabsContent>

          <TabsContent value="understand">
            <UnderstandTab
              results={results}
              selectedSources={selectedSources}
              selectedCategories={selectedCategories}
              highlightSourceName={sonicSimSubject}
              onToggleSource={toggleSource}
              onClearSources={clearAllFilters}
              onToggleCategory={toggleCategory}
              onClearCategories={clearCategoryFilters}
            />
          </TabsContent>

          <TabsContent value="library">
            <LibraryTab
              userId={user?.id ?? null}
              myFingerprint={myFingerprint}
              allFingerprints={allFingerprints}
              myAnalyses={(myAnalyses || []) as never}
            />
          </TabsContent>
        </Tabs>
      </div>

      {/* Step 16.0 — asked once: "What brings you here?" */}
      <PersonaChooser
        open={personaReady && !persona && !isAdmin && !personaAsked}
        onChoose={setPersona}
        onDismiss={() => setPersonaAsked(true)}
      />

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
              <div className="mt-3 flex flex-wrap items-center gap-4">
                <a
                  href="mailto:hello@example.com?subject=SonicSIM%20Enterprise%20—%20Learn%20More"
                  className="inline-flex items-center text-sm font-medium text-primary underline-offset-4 hover:underline"
                >
                  Learn More
                </a>
                <Link
                  to="/workspace"
                  className="inline-flex items-center text-sm font-medium text-primary underline-offset-4 hover:underline"
                >
                  Open enterprise workspace
                </Link>
              </div>
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
