import { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { toast } from "sonner";
import { 
  Users, 
  Music, 
  Network, 
  ArrowLeft, 
  Sparkles,
  User,
  FileAudio,
  Filter,
  X,
  Check,
  Fingerprint,
  GitCompare,
  Clock,
  History,
  ShieldCheck,
  Plug,
  Activity,
  Radio,
  ChevronDown,
  ChevronRight,
  Layers,

} from "lucide-react";
import { NetworkVisualization } from "@/components/NetworkVisualization";
import { AnalysisResults } from "@/components/AnalysisResults";
import { AggregateNetworkVisualization } from "@/components/AggregateNetworkVisualization";
import { FingerprintComparison } from "@/components/FingerprintComparison";
import { useFingerprints } from "@/hooks/useFingerprints";
import { useEC2Api } from "@/hooks/useEC2Api";
import { calculateSimilarity, type FingerprintMode } from "@/lib/fingerprintMath";
import { SignalCohortPanel } from "@/components/SignalCohortPanel";
import { IdentifierFilterBar } from "@/components/IdentifierFilterBar";
import {
  EMPTY_IDENTIFIER_FILTER,
  filterSignalPoints,
  identifierFilterCount,
  tagOptions,
  type IdentifierFilterState,
} from "@/lib/identifierFilters";
import {
  buildSignalPoints,
  clusterSignals,
  cohortFingerprint,
  metaFingerprint,
  suggestedK,
  type IdentifierRow,
  type SourceBaseline,
} from "@/lib/identifierSignals";

interface UserProfile {
  id: string;
  user_id: string;
  username: string | null;
  avatar_url: string | null;
  bio: string | null;
  created_at: string;
}

interface AudioSourceWithProfile {
  id: string;
  user_id: string;
  source_type: string;
  name: string;
  spotify_id: string | null;
  album_image: string | null;
  artists: string[] | null;
  preview_url: string | null;
  created_at: string;
  profile?: UserProfile | null;
}

type EntityMode = "user" | "provider" | "signal";

const PROVIDER_META: Record<string, { label: string; description: string }> = {
  spotify: { label: "Spotify", description: "Music streaming catalog" },
  file: { label: "File uploads", description: "Direct audio uploads" },
  intuizi: { label: "Intuizi", description: "Signal provider feed (CTV / apps)" },
  ctv: { label: "CTV feed", description: "Connected TV audio signals" },
};

const providerMeta = (key: string) =>
  PROVIDER_META[key] || { label: key, description: "Signal source" };

const AdminDashboard = () => {
  const { user, isAdmin, loading } = useAuth();
  const navigate = useNavigate();
  const { allFingerprints, loading: fingerprintsLoading, refresh: refreshFingerprints } = useFingerprints();
  const { checkHealth, loading: ec2Loading } = useEC2Api();

  const handleHealthCheck = async () => {
    const result = await checkHealth();
    if (result.error) {
      toast.error(`EC2 Connection Failed: ${result.error}`);
    } else {
      toast.success(`EC2 Connected! Status: ${result.data?.status || "OK"}`);
    }
  };
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [allSources, setAllSources] = useState<AudioSourceWithProfile[]>([]);
  const [selectedUserIds, setSelectedUserIds] = useState<string[]>([]);
  const [selectedSourceIds, setSelectedSourceIds] = useState<string[]>([]);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisResults, setAnalysisResults] = useState<{ sources: any[]; images: any[] } | null>(null);
  const [activeTab, setActiveTab] = useState("users");
  const [dataLoading, setDataLoading] = useState(true);
  const [filteredUserIds, setFilteredUserIds] = useState<string[]>([]);
  const [filteredProviders, setFilteredProviders] = useState<string[]>([]);
  const [entityMode, setEntityMode] = useState<EntityMode>("user");
  const [filterOpen, setFilterOpen] = useState(false);
  const [expandedGroups, setExpandedGroups] = useState<string[]>([]);
  const [signalCounts, setSignalCounts] = useState<Record<string, number>>({});
  const [compareMode, setCompareMode] = useState<FingerprintMode>("all");
  const [neighborsOpenFor, setNeighborsOpenFor] = useState<string | null>(null);

  // Identifier-level (Intuizi) signal state. Loaded lazily the first time the
  // admin switches into signal mode — it is by far the largest table here.
  const [identifierRows, setIdentifierRows] = useState<IdentifierRow[] | null>(null);
  const [sourceBaselines, setSourceBaselines] = useState<Record<string, SourceBaseline>>({});
  const [signalsLoading, setSignalsLoading] = useState(false);
  const [cohortCount, setCohortCount] = useState(4);
  const [cohortCountTouched, setCohortCountTouched] = useState(false);
  const [selectedCohortKeys, setSelectedCohortKeys] = useState<string[]>([]);
  const [identifierFilter, setIdentifierFilter] = useState<IdentifierFilterState>({
    ...EMPTY_IDENTIFIER_FILTER,
  });

  const allSignalPoints = useMemo(
    () => (identifierRows ? buildSignalPoints(identifierRows, sourceBaselines) : []),
    [identifierRows, sourceBaselines],
  );
  // Identifier-level filters apply before clustering, so cohorts, the meta
  // rollup, aggregate, compare and analysis all reflect the same scope.
  const signalPoints = useMemo(
    () => filterSignalPoints(allSignalPoints, identifierFilter),
    [allSignalPoints, identifierFilter],
  );
  const identifierTagOptions = useMemo(
    () => tagOptions(allSignalPoints.map(p => p.tags)),
    [allSignalPoints],
  );
  const cohorts = useMemo(() => clusterSignals(signalPoints, cohortCount), [signalPoints, cohortCount]);
  const meta = useMemo(
    () => metaFingerprint(cohorts, "All Intuizi identifiers"),
    [cohorts],
  );
  const cohortFingerprints = useMemo(() => {
    const scoped = selectedCohortKeys.length
      ? cohorts.filter(c => selectedCohortKeys.includes(c.key))
      : cohorts;
    const list = scoped.map(cohortFingerprint);
    // Include the meta rollup alongside cohorts so aggregate/compare views can
    // show each cohort against the population-level fingerprint.
    return meta && scoped.length > 1 ? [...list, meta as any] : list;
  }, [cohorts, selectedCohortKeys, meta]);

  const displayedUsers = filteredUserIds.length > 0 
    ? users.filter(u => filteredUserIds.includes(u.user_id))
    : users;

  const providerKeys = Array.from(new Set(allSources.map(s => s.source_type))).sort();
  const displayedProviders = filteredProviders.length > 0
    ? providerKeys.filter(p => filteredProviders.includes(p))
    : providerKeys;

  // Users implied by the active provider filter (used to scope aggregate/compare)
  const providerScopedUserIds = Array.from(
    new Set(
      allSources
        .filter(s => filteredProviders.length === 0 || filteredProviders.includes(s.source_type))
        .map(s => s.user_id)
    )
  );

  const scopedFingerprints = entityMode === "signal"
    ? (cohortFingerprints as any[])
    : entityMode === "user"
    ? (filteredUserIds.length > 0
        ? allFingerprints.filter(fp => filteredUserIds.includes(fp.user_id))
        : allFingerprints)
    : (filteredProviders.length > 0
        ? allFingerprints.filter(fp => providerScopedUserIds.includes(fp.user_id))
        : allFingerprints);

  const activeFilterCount = entityMode === "signal"
    ? selectedCohortKeys.length + identifierFilterCount(identifierFilter)
    : entityMode === "user"
      ? filteredUserIds.length
      : filteredProviders.length;

  const toggleUserFilter = (userId: string) => {
    setFilteredUserIds(prev =>
      prev.includes(userId)
        ? prev.filter(id => id !== userId)
        : [...prev, userId]
    );
  };

  const toggleProviderFilter = (provider: string) => {
    setFilteredProviders(prev =>
      prev.includes(provider)
        ? prev.filter(p => p !== provider)
        : [...prev, provider]
    );
  };

  const toggleGroup = (key: string) => {
    setExpandedGroups(prev =>
      prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]
    );
  };

  const toggleCohortFilter = (key: string) => {
    setSelectedCohortKeys(prev =>
      prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]
    );
  };

  const clearFilters = () => {
    setFilteredUserIds([]);
    setFilteredProviders([]);
    setSelectedCohortKeys([]);
    setIdentifierFilter({ ...EMPTY_IDENTIFIER_FILTER });
  };

  // Fetch identifier-level signals + their linked source baselines on demand.
  const fetchSignalData = async () => {
    setSignalsLoading(true);
    try {
      const PAGE = 1000;
      const rows: IdentifierRow[] = [];
      for (let from = 0; from < 20000; from += PAGE) {
        const { data, error } = await supabase
          .from("intuizi_identifiers")
          .select(
            "id, primary_identifier, tag_codes, observation_count, last_seen_at, audio_source_id, ctv_signals, apps_signals, visitation_signals, demographics_signals, origin_signals"
          )
          .order("created_at", { ascending: false })
          .range(from, from + PAGE - 1);
        if (error) throw error;
        rows.push(...((data || []) as unknown as IdentifierRow[]));
        if (!data || data.length < PAGE) break;
      }
      setIdentifierRows(rows);

      const sourceIds = Array.from(
        new Set(rows.map(r => r.audio_source_id).filter((v): v is string => !!v))
      );
      const baselines: Record<string, SourceBaseline> = {};
      if (sourceIds.length) {
        const { data: analyses } = await supabase
          .from("source_analyses")
          .select(
            "audio_source_id, emotional_score, cognitive_score, social_score, communication_score, contextual_score, artistic_score, confidence, created_at"
          )
          .in("audio_source_id", sourceIds)
          .order("created_at", { ascending: false });
        // Most recent analysis wins per source.
        (analyses || []).forEach(a => {
          if (!a.audio_source_id || baselines[a.audio_source_id]) return;
          baselines[a.audio_source_id] = {
            emotional: Number(a.emotional_score) || 0,
            cognitive: Number(a.cognitive_score) || 0,
            social: Number(a.social_score) || 0,
            communication: Number(a.communication_score) || 0,
            contextual: Number(a.contextual_score) || 0,
            artistic: Number(a.artistic_score) || 0,
            confidence: Number(a.confidence) || 0.5,
          };
        });
      }
      setSourceBaselines(baselines);
    } catch (err) {
      console.error("Failed to load identifier signals", err);
      toast.error("Could not load identifier-level signals");
      setIdentifierRows([]);
    } finally {
      setSignalsLoading(false);
    }
  };

  useEffect(() => {
    if (entityMode === "signal" && isAdmin && identifierRows === null && !signalsLoading) {
      fetchSignalData();
    }
  }, [entityMode, isAdmin, identifierRows, signalsLoading]);

  // Default cohort count follows population size until the admin overrides it.
  useEffect(() => {
    if (!cohortCountTouched && signalPoints.length) {
      setCohortCount(suggestedK(signalPoints.length));
    }
  }, [signalPoints.length, cohortCountTouched]);


  useEffect(() => {
    if (!loading && (!user || !isAdmin)) {
      toast.error("Access denied. Admin privileges required.");
      navigate("/");
    }
  }, [user, isAdmin, loading, navigate]);

  useEffect(() => {
    if (isAdmin) {
      fetchAllData();
    }
  }, [isAdmin]);

  const fetchAllData = async () => {
    setDataLoading(true);
    
    // Fetch all profiles
    const { data: profilesData } = await supabase
      .from('profiles')
      .select('*')
      .order('created_at', { ascending: false });
    
    setUsers(profilesData || []);

    // Fetch all audio sources
    const { data: sourcesData } = await supabase
      .from('audio_sources')
      .select('*')
      .order('created_at', { ascending: false });

    // Map profiles to sources
    const sourcesWithProfiles = (sourcesData || []).map(source => ({
      ...source,
      profile: (profilesData || []).find(p => p.user_id === source.user_id) || null,
    }));

    setAllSources(sourcesWithProfiles);

    // Intuizi signal volume per audio source (linked identifiers)
    const { data: identifierRows } = await supabase
      .from('intuizi_identifiers')
      .select('audio_source_id, observation_count');

    const counts: Record<string, number> = {};
    (identifierRows || []).forEach(row => {
      if (!row.audio_source_id) return;
      counts[row.audio_source_id] = (counts[row.audio_source_id] || 0) + 1;
    });
    setSignalCounts(counts);

    setDataLoading(false);
  };


  const toggleUserSelection = (userId: string) => {
    setSelectedUserIds(prev =>
      prev.includes(userId)
        ? prev.filter(id => id !== userId)
        : [...prev, userId]
    );
  };

  const toggleSourceSelection = (sourceId: string) => {
    setSelectedSourceIds(prev =>
      prev.includes(sourceId)
        ? prev.filter(id => id !== sourceId)
        : [...prev, sourceId]
    );
  };

  const selectAllUserSources = (userId: string) => {
    const userSourceIds = allSources
      .filter(s => s.user_id === userId)
      .map(s => s.id);
    
    setSelectedSourceIds(prev => {
      const otherIds = prev.filter(id => !userSourceIds.includes(id));
      const hasAll = userSourceIds.every(id => prev.includes(id));
      return hasAll ? otherIds : [...new Set([...prev, ...userSourceIds])];
    });
  };

  const handleAnalyzeSelected = async () => {
    const sourcesToAnalyze = allSources.filter(s => selectedSourceIds.includes(s.id));
    
    if (sourcesToAnalyze.length === 0) {
      toast.error("Please select at least one audio source to analyze");
      return;
    }

    setIsAnalyzing(true);
    setAnalysisResults(null);

    try {
      const sources = sourcesToAnalyze.map(s => ({
        name: s.name,
        type: s.source_type === 'spotify' ? 'track' as const : 'file' as const,
        spotify_id: s.spotify_id || undefined, // Enable cache lookup by Spotify ID
      }));

      const { data, error } = await supabase.functions.invoke('analyze-audio', {
        body: { sources }
      });

      if (error) throw new Error(error.message);
      if (data?.error) throw new Error(data.error);
      if (!data?.sources) throw new Error('Invalid analysis response');

      const imageData = sourcesToAnalyze
        .filter(s => s.album_image)
        .map(s => ({
          name: s.name,
          imageUrl: s.album_image!,
        }));

      setAnalysisResults({ sources: data.sources, images: imageData });
      setActiveTab("analysis");
      toast.success(`Analysis complete for ${sourcesToAnalyze.length} sources across users`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Analysis failed');
    } finally {
      setIsAnalyzing(false);
    }
  };

  // Compute top 3 closest users for a given user_id from cached fingerprints
  const getTopNeighbors = (userId: string, limit = 3) => {
    const target = allFingerprints.find(fp => fp.user_id === userId);
    if (!target) return [];
    return allFingerprints
      .filter(fp => fp.user_id !== userId)
      .map(fp => ({ fp, similarity: calculateSimilarity(target as any, fp as any, "all") }))
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, limit);
  };

  const getSourcesByUser = (userId: string) => allSources.filter(s => s.user_id === userId);

  const getSourcesByProvider = (provider: string) =>
    allSources.filter(s => s.source_type === provider);

  const selectAllProviderSources = (provider: string) => {
    const ids = getSourcesByProvider(provider).map(s => s.id);
    setSelectedSourceIds(prev => {
      const others = prev.filter(id => !ids.includes(id));
      const hasAll = ids.every(id => prev.includes(id));
      return hasAll ? others : [...new Set([...prev, ...ids])];
    });
  };

  const renderSourceRow = (source: AudioSourceWithProfile, showOwner = false) => (
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


  if (loading || dataLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="h-16 w-16 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  if (!isAdmin) return null;

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="border-b border-border bg-card/50">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="sm" onClick={() => navigate("/")}>
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back
            </Button>
            <h1 className="text-2xl font-bold text-foreground">Admin Dashboard</h1>
            <Badge variant="secondary" className="bg-primary/20 text-primary">
              Admin
            </Badge>
          </div>
          
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="gap-2 border-green-500/50 text-green-500 hover:bg-green-500/10"
              onClick={handleHealthCheck}
              disabled={ec2Loading}
            >
              <Activity className={`h-4 w-4 ${ec2Loading ? "animate-pulse" : ""}`} />
              <span className="hidden sm:inline">{ec2Loading ? "Checking..." : "EC2 Health"}</span>
            </Button>

            {selectedSourceIds.length > 0 && (
              <Button
                onClick={handleAnalyzeSelected}
                disabled={isAnalyzing}
                className="gradient-primary"
              >
                <Sparkles className="h-4 w-4 mr-2" />
                {isAnalyzing ? "Analyzing..." : `Analyze ${selectedSourceIds.length} Sources`}
              </Button>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={() => navigate("/admin/pipeline")}
            >
              <Activity className="h-4 w-4 mr-2" />
              Integration Status
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => navigate("/admin/integrations")}
            >
              <Plug className="h-4 w-4 mr-2" />
              API Integrations
            </Button>
          </div>
        </div>
      </div>

      {/* Stats Overview */}
      <div className="max-w-7xl mx-auto px-6 py-6">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
          <Card className="p-4 bg-card/80">
            <div className="flex items-center gap-3">
              <Users className="h-8 w-8 text-primary" />
              <div>
                <p className="text-2xl font-bold text-foreground">{users.length}</p>
                <p className="text-sm text-muted-foreground">Total Users</p>
              </div>
            </div>
          </Card>
          <Card className="p-4 bg-card/80">
            <div className="flex items-center gap-3">
              <Music className="h-8 w-8 text-primary" />
              <div>
                <p className="text-2xl font-bold text-foreground">{allSources.length}</p>
                <p className="text-sm text-muted-foreground">Total Audio Sources</p>
              </div>
            </div>
          </Card>
          <Card className="p-4 bg-card/80">
            <div className="flex items-center gap-3">
              <Network className="h-8 w-8 text-primary" />
              <div>
                <p className="text-2xl font-bold text-foreground">{selectedSourceIds.length}</p>
                <p className="text-sm text-muted-foreground">Selected for Analysis</p>
              </div>
            </div>
          </Card>
        </div>

        {/* Global meta filter: entity mode + filter picker (applies to all tabs) */}
        <Card className="p-4 mb-6 bg-card/80">
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-3 flex-wrap">
              <span className="text-sm font-medium text-muted-foreground">Filter by source</span>
              <div className="inline-flex rounded-md border border-border p-0.5 bg-muted">
                <Button
                  size="sm"
                  variant={entityMode === "user" ? "default" : "ghost"}
                  className="h-8 gap-1.5"
                  onClick={() => setEntityMode("user")}
                >
                  <User className="h-3.5 w-3.5" />
                  User
                </Button>
                <Button
                  size="sm"
                  variant={entityMode === "provider" ? "default" : "ghost"}
                  className="h-8 gap-1.5"
                  onClick={() => setEntityMode("provider")}
                >
                  <Radio className="h-3.5 w-3.5" />
                  Signal Provider
                </Button>
                <Button
                  size="sm"
                  variant={entityMode === "signal" ? "default" : "ghost"}
                  className="h-8 gap-1.5"
                  onClick={() => setEntityMode("signal")}
                >
                  <Layers className="h-3.5 w-3.5" />
                  Identifier Signals
                </Button>
              </div>
            </div>

            <div className="flex items-center gap-3 flex-wrap">
              <Popover open={filterOpen} onOpenChange={setFilterOpen}>
                <PopoverTrigger asChild>
                  <Button variant="outline" className="gap-2">
                    <Filter className="h-4 w-4" />
                    Filter by
                    {activeFilterCount > 0 && (
                      <Badge variant="secondary" className="ml-1">
                        {activeFilterCount}
                      </Badge>
                    )}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-72 p-0 bg-popover" align="start">
                  <Command>
                    <CommandInput
                      placeholder={
                        entityMode === "user"
                          ? "Search users..."
                          : entityMode === "provider"
                            ? "Search signal providers..."
                            : "Search cohorts..."
                      }
                    />
                    <CommandList>
                      <CommandEmpty>
                        {entityMode === "user"
                          ? "No users found."
                          : entityMode === "provider"
                            ? "No signal providers found."
                            : "No cohorts yet."}
                      </CommandEmpty>
                      <CommandGroup>
                        {entityMode === "user"
                          ? users.map(u => (
                              <CommandItem
                                key={u.user_id}
                                onSelect={() => toggleUserFilter(u.user_id)}
                                className="flex items-center gap-2 cursor-pointer"
                              >
                                <Avatar className="h-6 w-6">
                                  <AvatarImage src={u.avatar_url || undefined} />
                                  <AvatarFallback><User className="h-3 w-3" /></AvatarFallback>
                                </Avatar>
                                <span className="flex-1">{u.username || 'Anonymous'}</span>
                                {filteredUserIds.includes(u.user_id) && (
                                  <Check className="h-4 w-4 text-primary" />
                                )}
                              </CommandItem>
                            ))
                          : entityMode === "signal"
                          ? cohorts.map(c => (
                              <CommandItem
                                key={c.key}
                                onSelect={() => toggleCohortFilter(c.key)}
                                className="flex items-center gap-2 cursor-pointer"
                              >
                                <Layers className="h-4 w-4 text-primary" />
                                <span className="flex-1">{c.label}</span>
                                <span className="text-xs text-muted-foreground mr-1">
                                  {c.members.length}
                                </span>
                                {selectedCohortKeys.includes(c.key) && (
                                  <Check className="h-4 w-4 text-primary" />
                                )}
                              </CommandItem>
                            ))
                          : providerKeys.map(p => (
                              <CommandItem
                                key={p}
                                onSelect={() => toggleProviderFilter(p)}
                                className="flex items-center gap-2 cursor-pointer"
                              >
                                <Radio className="h-4 w-4 text-primary" />
                                <span className="flex-1">{providerMeta(p).label}</span>
                                <span className="text-xs text-muted-foreground mr-1">
                                  {allSources.filter(s => s.source_type === p).length}
                                </span>
                                {filteredProviders.includes(p) && (
                                  <Check className="h-4 w-4 text-primary" />
                                )}
                              </CommandItem>
                            ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>

              {/* Filter badges */}
              {entityMode === "user"
                ? filteredUserIds.map(uid => {
                    const u = users.find(user => user.user_id === uid);
                    if (!u) return null;
                    return (
                      <Badge key={uid} variant="secondary" className="gap-1 pr-1">
                        {u.username || 'Anonymous'}
                        <button
                          onClick={() => toggleUserFilter(uid)}
                          className="ml-1 hover:bg-muted rounded-full p-0.5"
                          aria-label={`Remove ${u.username || 'Anonymous'} filter`}
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </Badge>
                    );
                  })
                : entityMode === "signal"
                ? selectedCohortKeys.map(key => {
                    const c = cohorts.find(co => co.key === key);
                    if (!c) return null;
                    return (
                      <Badge key={key} variant="secondary" className="gap-1 pr-1">
                        {c.label}
                        <button
                          onClick={() => toggleCohortFilter(key)}
                          className="ml-1 hover:bg-muted rounded-full p-0.5"
                          aria-label={`Remove ${c.label} filter`}
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </Badge>
                    );
                  })
                : filteredProviders.map(p => (
                    <Badge key={p} variant="secondary" className="gap-1 pr-1">
                      {providerMeta(p).label}
                      <button
                        onClick={() => toggleProviderFilter(p)}
                        className="ml-1 hover:bg-muted rounded-full p-0.5"
                        aria-label={`Remove ${providerMeta(p).label} filter`}
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </Badge>
                  ))}

              {activeFilterCount > 0 && (
                <Button variant="ghost" size="sm" onClick={clearFilters}>
                  Clear All
                </Button>
              )}
            </div>

            {entityMode === "signal" && (
              <div className="pt-1 border-t border-border/60">
                <IdentifierFilterBar
                  value={identifierFilter}
                  onChange={setIdentifierFilter}
                  tags={identifierTagOptions}
                  resultCount={signalPoints.length}
                  totalCount={allSignalPoints.length}
                  placeholder="Search pseudonym, tag code or facet…"
                  className="pt-3"
                />
              </div>
            )}
          </div>
        </Card>

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="mb-6">
            <TabsTrigger value="users" className="gap-2">
              <Users className="h-4 w-4" />
              {entityMode === "user"
                ? "Users & Sources"
                : entityMode === "provider"
                  ? "Providers & Signals"
                  : "Cohorts & Identifiers"}
            </TabsTrigger>
            <TabsTrigger value="fingerprints" className="gap-2">
              <Fingerprint className="h-4 w-4" />
              <span className="hidden sm:inline">Aggregate</span>
            </TabsTrigger>
            <TabsTrigger value="compare" className="gap-2">
              <GitCompare className="h-4 w-4" />
              <span className="hidden sm:inline">Compare</span>
            </TabsTrigger>
            <TabsTrigger value="analysis" className="gap-2" disabled={!analysisResults}>
              <Network className="h-4 w-4" />
              <span className="hidden sm:inline">Analysis</span>
            </TabsTrigger>
          </TabsList>

          <TabsContent value="users" className="space-y-4">
            {entityMode === "signal" ? (
              <SignalCohortPanel
                points={signalPoints}
                cohorts={cohorts}
                meta={meta}
                cohortCount={cohortCount}
                onCohortCountChange={(k) => {
                  setCohortCountTouched(true);
                  setCohortCount(k);
                }}
                selectedCohortKeys={selectedCohortKeys}
                onToggleCohort={toggleCohortFilter}
                loading={signalsLoading}
              />
            ) : entityMode === "user" ? (
              displayedUsers.length === 0 ? (
                <Card className="p-8 text-center">
                  <Users className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
                  <p className="text-lg text-muted-foreground">
                    {filteredUserIds.length > 0 ? 'No users match your filter' : 'No users yet'}
                  </p>
                </Card>
              ) : (
                displayedUsers.map(userProfile => {
                  const userSources = getSourcesByUser(userProfile.user_id);
                  const allSelected = userSources.length > 0 &&
                    userSources.every(s => selectedSourceIds.includes(s.id));
                  const groupKey = `user:${userProfile.user_id}`;
                  const isExpanded = expandedGroups.includes(groupKey);
                  const fp = allFingerprints.find(f => f.user_id === userProfile.user_id);

                  return (
                    <Card key={userProfile.id} className="p-6 bg-card/80">
                      <div className="flex items-start justify-between gap-3 flex-wrap">
                        <div className="flex items-center gap-4">
                          <Checkbox
                            checked={selectedUserIds.includes(userProfile.user_id)}
                            onCheckedChange={() => toggleUserSelection(userProfile.user_id)}
                          />
                          <Avatar className="h-12 w-12">
                            <AvatarImage src={userProfile.avatar_url || undefined} />
                            <AvatarFallback>
                              <User className="h-6 w-6" />
                            </AvatarFallback>
                          </Avatar>
                          <div>
                            <h3 className="font-semibold text-foreground">
                              {userProfile.username || 'Anonymous User'}
                            </h3>
                            <p className="text-sm text-muted-foreground">
                              {userSources.length} audio source{userSources.length !== 1 ? 's' : ''}
                            </p>
                            {userProfile.bio && (
                              <p className="text-sm text-muted-foreground mt-1">{userProfile.bio}</p>
                            )}
                          </div>
                        </div>

                        <div className="flex items-center gap-2">
                          {userSources.length > 0 && (
                            <>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="gap-1"
                                onClick={() => toggleGroup(groupKey)}
                              >
                                {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                                {isExpanded ? 'Hide' : 'Show'} sources
                              </Button>
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => selectAllUserSources(userProfile.user_id)}
                              >
                                {allSelected ? 'Deselect All' : 'Select All Sources'}
                              </Button>
                            </>
                          )}
                        </div>
                      </div>

                      {isExpanded && userSources.length > 0 && (
                        <div className="grid gap-2 ml-10 mt-4">
                          {userSources.map(source => renderSourceRow(source))}
                        </div>
                      )}

                      {/* Confidence + Neighbors */}
                      {fp && (() => {
                        const conf = Number(fp.fingerprint_confidence) || 0;
                        const confLabel = conf >= 0.7 ? "High" : conf >= 0.4 ? "Medium" : "Low";
                        const isOpen = neighborsOpenFor === userProfile.user_id;
                        const neighbors = isOpen ? getTopNeighbors(userProfile.user_id, 3) : [];
                        return (
                          <div className="ml-10 mt-3 flex flex-col gap-2">
                            <div className="flex items-center gap-2 flex-wrap">
                              <Badge variant="secondary" className="gap-1">
                                <ShieldCheck className="h-3 w-3" />
                                {confLabel} confidence • {fp.total_sources_analyzed} sources
                              </Badge>
                              {fp.recent_sources_analyzed > 0 && (
                                <Badge variant="outline" className="gap-1">
                                  <Clock className="h-3 w-3" />
                                  {fp.recent_sources_analyzed} in last 30d
                                </Badge>
                              )}
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 text-xs"
                                onClick={() => setNeighborsOpenFor(isOpen ? null : userProfile.user_id)}
                              >
                                {isOpen ? "Hide" : "Show"} Taste Neighbors
                              </Button>
                            </div>
                            {isOpen && (
                              <div className="flex flex-wrap gap-2">
                                {neighbors.length === 0 ? (
                                  <span className="text-xs text-muted-foreground">No neighbors yet.</span>
                                ) : neighbors.map(n => (
                                  <Badge key={n.fp.user_id} variant="outline" className="gap-1.5">
                                    <Avatar className="h-4 w-4">
                                      <AvatarImage src={n.fp.avatar_url || undefined} />
                                      <AvatarFallback><User className="h-2 w-2" /></AvatarFallback>
                                    </Avatar>
                                    {n.fp.username || "Anonymous"} • {(n.similarity * 100).toFixed(0)}%
                                  </Badge>
                                ))}
                              </div>
                            )}
                          </div>
                        );
                      })()}
                    </Card>
                  );
                })
              )
            ) : (
              displayedProviders.length === 0 ? (
                <Card className="p-8 text-center">
                  <Radio className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
                  <p className="text-lg text-muted-foreground">
                    {filteredProviders.length > 0 ? 'No providers match your filter' : 'No signal providers yet'}
                  </p>
                </Card>
              ) : (
                displayedProviders.map(provider => {
                  const providerSources = getSourcesByProvider(provider);
                  const groupKey = `provider:${provider}`;
                  const isExpanded = expandedGroups.includes(groupKey);
                  const allSelected = providerSources.length > 0 &&
                    providerSources.every(s => selectedSourceIds.includes(s.id));
                  const linkedSignals = providerSources.reduce(
                    (sum, s) => sum + (signalCounts[s.id] || 0), 0
                  );
                  const contributors = new Set(providerSources.map(s => s.user_id)).size;
                  const meta = providerMeta(provider);

                  return (
                    <Card key={provider} className="p-6 bg-card/80">
                      <div className="flex items-start justify-between gap-3 flex-wrap">
                        <div className="flex items-center gap-4">
                          <div className="h-12 w-12 rounded-lg gradient-primary flex items-center justify-center">
                            <Radio className="h-6 w-6 text-primary-foreground" />
                          </div>
                          <div>
                            <h3 className="font-semibold text-foreground">{meta.label}</h3>
                            <p className="text-sm text-muted-foreground">{meta.description}</p>
                            <div className="flex items-center gap-2 mt-2 flex-wrap">
                              <Badge variant="secondary">
                                {providerSources.length} signal{providerSources.length !== 1 ? 's' : ''}
                              </Badge>
                              <Badge variant="outline">
                                {contributors} account{contributors !== 1 ? 's' : ''}
                              </Badge>
                              {linkedSignals > 0 && (
                                <Badge variant="outline" className="gap-1">
                                  <Users className="h-3 w-3" />
                                  {linkedSignals} linked identifiers
                                </Badge>
                              )}
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center gap-2">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="gap-1"
                            onClick={() => toggleGroup(groupKey)}
                          >
                            {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                            {isExpanded ? 'Hide' : 'Show'} signals
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => selectAllProviderSources(provider)}
                          >
                            {allSelected ? 'Deselect All' : 'Select All Signals'}
                          </Button>
                        </div>
                      </div>

                      {isExpanded && providerSources.length > 0 && (
                        <div className="grid gap-2 ml-4 mt-4">
                          {providerSources.map(source => renderSourceRow(source, true))}
                        </div>
                      )}
                    </Card>
                  );
                })
              )
            )}
          </TabsContent>


          <TabsContent value="fingerprints" className="space-y-6">
            <div className="flex justify-between items-center">
              <div>
                <h3 className="text-lg font-semibold text-foreground">
                  {entityMode === "signal" ? "Aggregate Cohort Fingerprints" : "Aggregate User Fingerprints"}
                </h3>
                <p className="text-sm text-muted-foreground">
                  {entityMode === "signal"
                    ? "Each bubble represents a pseudonymized identifier cohort rolled up from Intuizi signals"
                    : "Each bubble represents a user's combined ontological fingerprint"}
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  Scope: {entityMode === "signal"
                    ? `identifier cohorts • ${scopedFingerprints.length} cohort fingerprint${scopedFingerprints.length !== 1 ? "s" : ""} from ${signalPoints.length.toLocaleString()} identifiers`
                    : activeFilterCount > 0
                      ? `${entityMode === "user" ? "users" : "signal providers"} filter • ${scopedFingerprints.length} of ${allFingerprints.length} fingerprints`
                      : `all ${allFingerprints.length} fingerprints`}
                </p>
              </div>
              <Button variant="outline" size="sm" onClick={refreshFingerprints} disabled={fingerprintsLoading}>
                {fingerprintsLoading ? 'Loading...' : 'Refresh'}
              </Button>
            </div>
            <AggregateNetworkVisualization 
              fingerprints={scopedFingerprints}
              onUserClick={(userId) => {
                if (userId.startsWith("cohort:") || userId.startsWith("meta:")) {
                  setSelectedCohortKeys(userId.startsWith("cohort:") ? [userId] : []);
                  setActiveTab("users");
                  return;
                }
                setEntityMode("user");
                setFilteredUserIds([userId]);
                setActiveTab("users");
              }}
            />

          </TabsContent>

          <TabsContent value="compare" className="space-y-6">
            <div className="flex justify-between items-center flex-wrap gap-3">
              <div>
                <h3 className="text-lg font-semibold text-foreground">
                  {entityMode === "signal" ? "Compare Cohort Fingerprints" : "Compare User Fingerprints"}
                </h3>
                <p className="text-sm text-muted-foreground">
                  {entityMode === "signal"
                    ? "Overlay identifier cohorts against each other and the meta rollup"
                    : "Select 2 or more users to overlay their radar charts side-by-side"}
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  Scope: {entityMode === "signal"
                    ? `identifier cohorts • ${scopedFingerprints.length} cohort fingerprint${scopedFingerprints.length !== 1 ? "s" : ""} from ${signalPoints.length.toLocaleString()} identifiers`
                    : activeFilterCount > 0
                      ? `${entityMode === "user" ? "users" : "signal providers"} filter • ${scopedFingerprints.length} of ${allFingerprints.length} fingerprints`
                      : `all ${allFingerprints.length} fingerprints`}

                </p>
              </div>
              <div className="flex items-center gap-2">
                <div className="inline-flex rounded-md border border-border p-0.5 bg-muted">
                  <Button
                    size="sm"
                    variant={compareMode === "all" ? "default" : "ghost"}
                    className="h-8 gap-1.5"
                    onClick={() => setCompareMode("all")}
                  >
                    <History className="h-3.5 w-3.5" />
                    All-Time
                  </Button>
                  <Button
                    size="sm"
                    variant={compareMode === "recent" ? "default" : "ghost"}
                    className="h-8 gap-1.5"
                    onClick={() => setCompareMode("recent")}
                  >
                    <Clock className="h-3.5 w-3.5" />
                    Last 30 Days
                  </Button>
                </div>
                <Button variant="outline" size="sm" onClick={refreshFingerprints} disabled={fingerprintsLoading}>
                  {fingerprintsLoading ? 'Loading...' : 'Refresh'}
                </Button>
              </div>
            </div>
            <FingerprintComparison fingerprints={scopedFingerprints} mode={compareMode} />
          </TabsContent>

          <TabsContent value="analysis" className="space-y-6">
            {analysisResults ? (
              <>
                <Card className="p-6 bg-card/80">
                  <h3 className="text-lg font-semibold mb-4">Cross-User Ontological Network</h3>
                  <NetworkVisualization
                    sources={analysisResults.sources}
                    sourceImages={analysisResults.images}
                  />
                </Card>
                
                <Card className="p-6 bg-card/80">
                  <h3 className="text-lg font-semibold mb-4">Detailed Analysis</h3>
                  <AnalysisResults 
                    results={analysisResults.sources} 
                    isAnalyzing={false}
                    sourceImages={analysisResults.images}
                  />
                </Card>
              </>
            ) : (
              <Card className="p-8 text-center">
                <Network className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
                <p className="text-lg text-muted-foreground">
                  Select sources from multiple users and click "Analyze" to compare ontological networks
                </p>
              </Card>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
};

export default AdminDashboard;