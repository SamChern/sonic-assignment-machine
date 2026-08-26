import { useState, useEffect, useRef, lazy, Suspense } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { AudioUploader } from "@/components/AudioUploader";
import { AnalysisResults, predictCategory, getCategoryStyles, getCategoryIcon } from "@/components/AnalysisResults";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Sparkles, FileAudio, Network, ListTree, User, LogOut, Save, Shield, Activity, ChevronDown, ChevronUp, Users as UsersIcon, Building2, Upload as UploadIcon, Compass, Target, LineChart, Sliders } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import heroBackground from "@/assets/hero-background.jpg";
import exampleOutput from "@/assets/example-output.png";
import secondaryImage from "@/assets/secondary-homepage-image.png";
import sonicSimLogo from "@/assets/SonicSIM_blend.png";
import fingerprintBg from "@/assets/fingerprint-bg.webp";
const WorkspaceAnalyses = lazy(() => import("@/components/enterprise/WorkspaceAnalyses"));
const WorkspaceUpload = lazy(() => import("@/components/enterprise/WorkspaceUpload"));
const DatasetDiscovery = lazy(() => import("@/components/enterprise/DatasetDiscovery"));

const NetworkVisualization = lazy(() =>
  import("@/components/NetworkVisualization").then((m) => ({ default: m.NetworkVisualization }))
);
import { Badge } from "@/components/ui/badge";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Check, X } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useOrganization } from "@/hooks/useOrganization";
import { useAudioSources, AudioSource } from "@/hooks/useAudioSources";
import { WaveformBackground } from "@/components/WaveformBackground";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { TasteNeighbors } from "@/components/TasteNeighbors";
import { useFingerprints } from "@/hooks/useFingerprints";
import { cn } from "@/lib/utils";
import { AudioJobsPanel } from "@/components/AudioJobsPanel";
import { UploadProgressPanel } from "@/components/UploadProgressPanel";


const Index = () => {
  const { user, profile, signOut, loading: authLoading, isAdmin } = useAuth();
  const { orgs: enterpriseOrgs, active: activeOrg, canWrite: orgCanWrite } = useOrganization();
  const hasEnterprise = enterpriseOrgs.length > 0;

  const { saveSpotifyTrack, saveFileSource } = useAudioSources();
  
  const { myFingerprint, allFingerprints } = useFingerprints();
  
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
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [open, setOpen] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();
  const [activeTab, setActiveTab] = useState<string>(
    () => searchParams.get("tab") ?? "select",
  );
  const [sourcesExpanded, setSourcesExpanded] = useState(true);
  const [showGetStartedDialog, setShowGetStartedDialog] = useState(false);
  const logoRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLElement>(null);

  // Keep the tab state and the ?tab= param in sync so the mobile bottom nav
  // can deep-link into a specific tab from any route.
  const urlTab = searchParams.get("tab");
  useEffect(() => {
    if (urlTab && urlTab !== activeTab) setActiveTab(urlTab);
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
        logoRef.current.style.setProperty('--logo-opacity', String(1 - progress * 0.92));
        logoRef.current.style.setProperty('--logo-overlay-opacity', String(progress * 0.92));
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
    setActiveTab("select");
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
          ) : user ? (
            <div className="flex items-center gap-1.5 sm:gap-3">
              {hasEnterprise && (
                <Link to="/workspace" aria-label="Enterprise workspace">
                  <Button variant="outline" size="sm" className="gap-2 border-primary/50 text-primary min-h-11 min-w-11 sm:min-h-9 sm:min-w-0">
                    <Building2 className="h-4 w-4" />
                    <span className="hidden sm:inline">Enterprise</span>
                  </Button>
                </Link>
              )}
              {isAdmin && (
                <Link to="/admin" aria-label="Admin dashboard">
                  <Button variant="outline" size="sm" className="gap-2 border-primary/50 text-primary min-h-11 min-w-11 sm:min-h-9 sm:min-w-0">
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
              <Button variant="ghost" size="sm" onClick={signOut} aria-label="Sign out" className="min-h-11 min-w-11 sm:min-h-9 sm:min-w-0">
                <LogOut className="h-4 w-4" />
              </Button>
            </div>
          ) : (
            <Link to="/auth">
              <Button variant="ghost" size="sm" className="gap-2 text-foreground/80 hover:text-foreground">
                <User className="h-4 w-4" />
                Sign In
              </Button>
            </Link>
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
          <div className="text-center" ref={logoRef}>
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
              <p className="text-lg sm:text-2xl text-foreground">
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

      {/* Enterprise Workspace Section */}
      <section aria-labelledby="enterprise-heading" className="mx-auto max-w-7xl px-4 sm:px-6 pt-8 sm:pt-12">
        <div className="relative overflow-hidden rounded-2xl border border-primary/30 bg-primary/5 p-5 sm:p-8">
          {/* Subtle cluster/network texture merged into the frame (static, not animated) */}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 opacity-[0.14] mix-blend-screen"
            style={{
              backgroundImage: `url(${fingerprintBg})`,
              backgroundSize: "cover",
              backgroundPosition: "center",
              maskImage:
                "radial-gradient(120% 90% at 80% 10%, hsl(0 0% 0% / 0.9), transparent 70%)",
              WebkitMaskImage:
                "radial-gradient(120% 90% at 80% 10%, hsl(0 0% 0% / 0.9), transparent 70%)",
            }}
          />
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-background/80 via-transparent to-transparent" />

          <div className="relative min-w-0">
          <Badge className="mb-3 inline-flex bg-primary text-primary-foreground sm:absolute sm:right-0 sm:top-0 sm:mb-0">
            Enterprise
          </Badge>
          <h2 id="enterprise-heading" className="text-xl sm:text-2xl font-semibold text-foreground sm:pr-28">
            {hasEnterprise && activeOrg ? `${activeOrg.name} enterprise workspace` : "SonicSIM Enterprise workspace"}
          </h2>
          <p className="mt-2 max-w-2xl text-sm sm:text-base text-muted-foreground">
            {hasEnterprise
              ? "Everything below is scoped to your organization's permissions — recent analyses, your own data, and dataset discovery."
              : "Licensed teams get a private dashboard scoped to their own data — recent analyses, their own data uploads, dataset discovery, and predictive modelling on the six-category semantic layer."}
          </p>

          {hasEnterprise && activeOrg ? (
            <Tabs defaultValue="analyses" className="mt-5 w-full min-w-0">
              <TabsList className="flex w-full max-w-full overflow-x-auto no-scrollbar justify-start sm:grid sm:grid-cols-3">
                <TabsTrigger value="analyses" className="min-h-11 shrink-0 sm:min-w-0">
                  <Sparkles className="mr-1 h-4 w-4 shrink-0" />
                  <span className="truncate">Recent analyses</span>
                </TabsTrigger>
                <TabsTrigger value="data" className="min-h-11 shrink-0 sm:min-w-0">
                  <UploadIcon className="mr-1 h-4 w-4 shrink-0" />
                  <span className="truncate">Upload my data</span>
                </TabsTrigger>
                <TabsTrigger value="discover" className="min-h-11 shrink-0 sm:min-w-0">
                  <Compass className="mr-1 h-4 w-4 shrink-0" />
                  <span className="truncate">Dataset discovery</span>
                </TabsTrigger>
              </TabsList>

              <Suspense fallback={<div className="mt-4 h-32 animate-pulse rounded-xl bg-muted/40" />}>
                <TabsContent value="analyses" className="mt-4">
                  <WorkspaceAnalyses organizationId={activeOrg.organization_id} />
                </TabsContent>
                <TabsContent value="data" className="mt-4">
                  <WorkspaceUpload organizationId={activeOrg.organization_id} canWrite={orgCanWrite} />
                </TabsContent>
                <TabsContent value="discover" className="mt-4">
                  <DatasetDiscovery organizationId={activeOrg.organization_id} />
                </TabsContent>
              </Suspense>
            </Tabs>
          ) : (
            <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {[
                { icon: Sparkles, title: "Recent analyses", body: "Every SonicSIM analysis your organization has run, permission-scoped." },
                { icon: UploadIcon, title: "Upload my own data", body: "Batch CSV to the published schema, or connect GCP/BigQuery, AWS S3 or Snowflake." },
                { icon: Compass, title: "Dataset discovery", body: "Same discovery experience as the home page, but across datasets instead of taste neighbors." },
                { icon: Target, title: "Predict users & outcomes", body: "Normalize the six categories, find like-minded users, and model KPI outcomes from pixel data." },
              ].map((item) => (
                <div key={item.title} className="rounded-xl border border-border/60 bg-background/50 p-4">
                  <item.icon className="h-5 w-5 text-primary" aria-hidden="true" />
                  <h3 className="mt-2 text-sm font-semibold text-foreground">{item.title}</h3>
                  <p className="mt-1 text-xs text-muted-foreground">{item.body}</p>
                </div>
              ))}
            </div>
          )}
          <div className="mt-5 flex flex-wrap items-center gap-3 min-w-0">
            <Button asChild size="lg" className="min-h-12 w-full sm:w-auto">
              <Link to="/workspace">
                <Building2 className="mr-2 h-5 w-5 shrink-0" />
                <span className="truncate">{hasEnterprise ? "Open enterprise workspace" : "Enterprise sign in"}</span>
              </Link>
            </Button>
            {hasEnterprise && (
              <>
                <Button asChild variant="outline" className="min-h-12 w-full sm:w-auto">
                  <Link to="/workspace?tab=categories">
                    <Sliders className="mr-2 h-4 w-4 shrink-0" />
                    <span className="truncate">Adjust 6 categories</span>
                  </Link>
                </Button>
                <Button asChild variant="outline" className="min-h-12 w-full sm:w-auto">
                  <Link to="/workspace?tab=users">
                    <Target className="mr-2 h-4 w-4 shrink-0" />
                    <span className="truncate">Predict SonicSIM-Users</span>
                  </Link>
                </Button>
                <Button asChild variant="outline" className="min-h-12 w-full sm:w-auto">
                  <Link to="/workspace?tab=outcomes">
                    <LineChart className="mr-2 h-4 w-4 shrink-0" />
                    <span className="truncate">Predict SonicSIM-Outcomes</span>
                  </Link>
                </Button>
                <a
                  href="mailto:hello@example.com?subject=SonicSIM%20Enterprise%20%E2%80%94%20Learn%20More"
                  className="text-sm font-medium text-primary underline-offset-4 hover:underline"
                >
                  Learn More
                </a>
              </>
            )}
            {!hasEnterprise && (
              <a
                href="mailto:hello@example.com?subject=SonicSIM%20Enterprise%20%E2%80%94%20Learn%20More"
                className="text-sm font-medium text-primary underline-offset-4 hover:underline"
              >
                Learn More
              </a>
            )}
          </div>
          <p className="mt-3 flex items-start gap-1 text-xs text-muted-foreground">
            <LineChart className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span>KPI modelling: traffic, CPC, CTR, page views, VCR, time on site</span>
          </p>

          </div>
        </div>
      </section>


      {/* Main Content with Tabs */}
      <div className="mx-auto max-w-7xl px-4 sm:px-6 py-8 sm:py-12">
        <Tabs value={activeTab} onValueChange={handleTabChange} className="w-full min-w-0">
          <TabsList className="mb-6 sm:mb-8 flex w-full max-w-full overflow-x-auto no-scrollbar justify-start sm:grid sm:grid-cols-4">
            <TabsTrigger value="select" className="flex shrink-0 items-center gap-2 min-h-11 sm:min-w-0">
              <FileAudio className="h-4 w-4 shrink-0" />
              <span className="hidden truncate sm:inline">Select Sources</span>
              <span className="truncate sm:hidden">Sources</span>
            </TabsTrigger>
            <TabsTrigger value="network" className="flex shrink-0 items-center gap-2 min-h-11 sm:min-w-0" disabled={!results}>
              <Network className="h-4 w-4 shrink-0" />
              <span className="truncate">Network</span>
            </TabsTrigger>
            <TabsTrigger value="analysis" className="flex shrink-0 items-center gap-2 min-h-11 sm:min-w-0" disabled={!results}>
              <ListTree className="h-4 w-4 shrink-0" />
              <span className="truncate">Analysis</span>
            </TabsTrigger>
            <TabsTrigger value="discover" className="flex shrink-0 items-center gap-2 min-h-11 sm:min-w-0" disabled={!user}>
              <UsersIcon className="h-4 w-4 shrink-0" />
              <span className="truncate">Discover</span>
            </TabsTrigger>
          </TabsList>


          {/* Tab 1: Select Audio Sources */}
          <TabsContent value="select" className="space-y-8">
            <div className="flex flex-col sm:flex-row sm:justify-between sm:items-start gap-3 mb-6">
              <div>
                <h2 className="text-xl sm:text-2xl font-bold text-foreground">
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
                onLibrarySelect={handleLibrarySelect}
              />
              {user && <AudioJobsPanel />}
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

            {/* Loading State with Progress — docks above the sticky bottom nav on mobile */}
            {isAnalyzing && analysisProgress && (
              <UploadProgressPanel
                status={analysisProgress.status}
                total={analysisProgress.total}
              />
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

            <Suspense
              fallback={
                <div className="flex h-[400px] items-center justify-center">
                  <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
                </div>
              }
            >
              <NetworkVisualization sources={filteredSources} sourceImages={filteredImages} />
            </Suspense>
          </TabsContent>

          {/* Tab 3: Per-Source Semantic Analysis */}
          <TabsContent value="analysis" className="space-y-6">
            {/* Category Filter Chips */}
            {results && results.sources.length > 0 && (
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-semibold text-foreground mr-1">Filter:</span>
                {["Emotional", "Cognitive", "Social", "Communication", "Contextual", "Artistic"].map((cat) => {
                  const styles = getCategoryStyles(cat);
                  const active = selectedCategories.includes(cat);
                  return (
                    <button
                      key={cat}
                      onClick={() => toggleCategory(cat)}
                      className={cn(
                        "flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition-all duration-200",
                        active
                          ? [styles.bg, styles.border, styles.text, "shadow-sm"].join(" ")
                          : "bg-muted/50 border-border/50 text-muted-foreground hover:bg-muted hover:text-foreground"
                      )}
                    >
                      {getCategoryIcon(cat)}
                      <span>{cat}</span>
                    </button>
                  );
                })}
                {selectedCategories.length > 0 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={clearCategoryFilters}
                    className="text-xs h-7 px-2"
                  >
                    Clear
                  </Button>
                )}
              </div>
            )}

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

            {(() => {
              const baseSources = selectedSources.length === 0
                ? results?.sources || []
                : (results?.sources || []).filter((source: any) =>
                    selectedSources.some(selected => selected.trim() === source.name.trim())
                  );
              const categoryFiltered = selectedCategories.length === 0
                ? baseSources
                : baseSources.filter((source: any) => {
                    const top = predictCategory(source.categories);
                    return top ? selectedCategories.includes(top.name) : false;
                  });
              const analysisImages = selectedSources.length === 0
                ? results?.images || []
                : (results?.images || []).filter((img: any) =>
                    selectedSources.some(selected => selected.trim() === img.name.trim())
                  );
              return (
                <AnalysisResults
                  results={categoryFiltered}
                  isAnalyzing={false}
                  sourceImages={analysisImages}
                />
              );
            })()}
          </TabsContent>

          {/* Tab 4: Discover — Taste Neighbors */}
          <TabsContent value="discover" className="space-y-6">
            {user && (
              <TasteNeighbors
                currentUserId={user.id}
                currentFingerprint={myFingerprint}
                allFingerprints={allFingerprints}
              />
            )}
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
