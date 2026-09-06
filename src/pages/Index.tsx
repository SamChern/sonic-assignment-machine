import { useState, useEffect, useRef } from "react";
import { Link, useSearchParams } from "react-router-dom";
import SonicSimPanel from "@/components/visuals/SonicSimPanel";
import ListenTab from "@/components/home/ListenTab";
import AccessPlans from "@/components/home/AccessPlans";
import UnderstandTab from "@/components/home/UnderstandTab";
import LibraryTab from "@/components/home/LibraryTab";
import HomeHeader from "@/components/home/HomeHeader";
import GetStartedDialog from "@/components/home/GetStartedDialog";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Sparkles, FileAudio, Network, ListTree } from "lucide-react";
import heroBackground from "@/assets/hero-background.jpg";
import { useScopeShowcase } from "@/hooks/useScopeShowcase";
import exampleOutput from "@/assets/example-output.png";
import sonicSimLogo from "@/assets/SonicSIM_blend.png";

import { useAuth } from "@/hooks/useAuth";
import { useOrganization } from "@/hooks/useOrganization";
import { usePersona } from "@/hooks/usePersona";
import PersonaChooser from "@/components/persona/PersonaChooser";
import ConsumerDoor from "@/components/home/ConsumerDoor";

import { useFingerprints } from "@/hooks/useFingerprints";
import { useHeaderScrollEffect } from "@/hooks/useHeaderScrollEffect";
import { useAudioSelectionState } from "@/hooks/useAudioSelectionState";
import { useHomeAnalysis } from "@/hooks/useHomeAnalysis";

import { normalizeTab } from "@/lib/homeTabs";

const Index = () => {
  const { user, profile, signOut, loading: authLoading, isAdmin } = useAuth();
  const { orgs: enterpriseOrgs } = useOrganization();
  const hasEnterprise = enterpriseOrgs.length > 0;
  const { persona, setPersona, ready: personaReady } = usePersona();
  const [personaAsked, setPersonaAsked] = useState(false);

  const { myFingerprint, allFingerprints, myAnalyses } = useFingerprints();

  /** Source name currently playing in "See my SonicSIM" — pulses its ontology nodes. */
  const [sonicSimSubject, setSonicSimSubject] = useState<string | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();
  const [activeTab, setActiveTab] = useState<string>(
    () => normalizeTab(searchParams.get("tab")),
  );
  const [showGetStartedDialog, setShowGetStartedDialog] = useState(false);
  /** Real recent-analysis averages for the home waveform (sample only if empty). */
  const scopeShowcase = useScopeShowcase();
  /** Scores from the visitor's own trial run, once they have one. */
  const [trialScope, setTrialScope] = useState<{ name: string; scores: Record<string, number> } | null>(
    null,
  );

  const { logoRef, headerRef } = useHeaderScrollEffect();

  const {
    selectedFiles,
    spotifyTracks,
    librarySources,
    totalItems,
    handleFileSelect,
    handleSpotifyTrack,
    handleLibrarySelect,
    removeLibrarySource,
    removeFile,
    removeTrack,
    clearAll,
  } = useAudioSelectionState({
    isSignedIn: !!user,
    onAdded: () => setActiveTab("listen"),
  });

  const {
    isAnalyzing,
    analysisProgress,
    results,
    selectedSources,
    selectedCategories,
    handleAnalyze,
    toggleSource,
    clearAllFilters,
    toggleCategory,
    clearCategoryFilters,
  } = useHomeAnalysis({
    userId: user?.id,
    totalItems,
    selectedFiles,
    spotifyTracks,
    librarySources,
    onComplete: () => setActiveTab("understand"),
  });

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

  const handleGetStarted = () => {
    setShowGetStartedDialog(false);
    setActiveTab("listen");
  };

  return (
    <div className="min-h-screen">
      {/* Sticky Header */}
      <HomeHeader
        headerRef={headerRef}
        authLoading={authLoading}
        persona={persona}
        onSelectPersona={setPersona}
        isSignedIn={!!user}
        isAdmin={isAdmin}
        hasEnterprise={hasEnterprise}
        avatarUrl={profile?.avatar_url}
        displayName={profile?.username || user?.email?.split("@")[0]}
        onSignOut={signOut}
      />

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
          title="SonicSIM 's MultiModal Semantics"
          description=""
          defaultMode="scope"
          modes={["scope", "radial", "nodes"]}
          height={200}
          subjects={[
            {
              id: "home-scope",
              label: "SonicSIM SCOPE",
              sublabel: trialScope
                ? `Your analysis · ${trialScope.name}`
                : scopeShowcase.sublabel,
              scores: trialScope
                ? {
                    emotional: Math.round(trialScope.scores.emotional || 0),
                    cognitive: Math.round(trialScope.scores.cognitive || 0),
                    social: Math.round(trialScope.scores.social || 0),
                    communication: Math.round(trialScope.scores.communication || 0),
                    contextual: Math.round(trialScope.scores.contextual || 0),
                    artistic: Math.round(trialScope.scores.artistic || 0),
                  }
                : scopeShowcase.scores,
            },
          ]}
        />

        {!user && (
          <div className="mt-6 grid gap-4 sm:grid-cols-3">
            <div className="rounded-xl border border-border/60 bg-card/50 p-4">
              <p className="text-sm font-semibold text-foreground">Listen</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Add a track — upload a file, search a streaming service, or pick from the shared
                library — and SonicSIM listens to it across six meaning categories.
              </p>
            </div>
            <div className="rounded-xl border border-border/60 bg-card/50 p-4">
              <p className="text-sm font-semibold text-foreground">Understand</p>
              <p className="mt-1 text-sm text-muted-foreground">
                See what it heard: scores for emotion, cognition, social, communication, context and
                artistry, plus how your sounds connect to each other.
              </p>
            </div>
            <div className="rounded-xl border border-border/60 bg-card/50 p-4">
              <p className="text-sm font-semibold text-foreground">Library</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Signed-in members keep every analysis, build a personal sonic signature, and compare
                it with other people&apos;s.
              </p>
            </div>
          </div>
        )}
      </section>


      {/* Step 16a — the Consumer door: one input, one result, one ladder. */}
      {persona !== "marketing" && (
        <div className="mx-auto max-w-4xl px-4 pb-2 pt-6 sm:px-6">
          <ConsumerDoor
            isSignedIn={!!user}
            userId={user?.id ?? null}
            allFingerprints={allFingerprints || []}
            onResult={setTrialScope}
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
              librarySources={librarySources}
              totalItems={totalItems}
              isAnalyzing={isAnalyzing}
              analysisProgress={analysisProgress}
              onFileSelect={handleFileSelect}
              onSpotifyTrack={handleSpotifyTrack}
              onLibrarySelect={handleLibrarySelect}
              onRemoveFile={removeFile}
              onRemoveTrack={removeTrack}
              onRemoveLibrarySource={removeLibrarySource}
              onClearAll={clearAll}
              onAnalyze={handleAnalyze}
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

      {!user && <AccessPlans />}

      {/* Step 16.0 — asked once: "What brings you here?" */}
      <PersonaChooser
        open={personaReady && !persona && !isAdmin && !personaAsked}
        onChoose={setPersona}
        onDismiss={() => setPersonaAsked(true)}
      />

      {/* Get Started Dialog */}
      <GetStartedDialog
        open={showGetStartedDialog}
        onOpenChange={setShowGetStartedDialog}
        onGetStarted={handleGetStarted}
      />
    </div>
  );
};

export default Index;
