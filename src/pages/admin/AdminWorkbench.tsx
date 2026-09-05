import { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import {
  Users,
  Network,
  Fingerprint,
  Activity,
  Radio,
  Layers,
} from "lucide-react";
import { ScopeCompareLens } from "@/components/visuals/ScopeCompareLens";
import { useFingerprints } from "@/hooks/useFingerprints";
import { fingerprintToScores } from "@/lib/audioscope";
import { EMPTY_IDENTIFIER_FILTER } from "@/lib/identifierFilters";
import { useEC2Api } from "@/hooks/useEC2Api";
import type { FingerprintMode } from "@/lib/fingerprintMath";
import { identifierFilterCount } from "@/lib/identifierFilters";
import { useIdentifierSignals } from "@/components/admin/workbench/useIdentifierSignals";
import { useWorkbenchData } from "@/components/admin/workbench/useWorkbenchData";
import { useWorkbenchSelection } from "@/components/admin/workbench/useWorkbenchSelection";
import { renderWorkbenchSourceRow } from "@/components/admin/workbench/WorkbenchSourceRow";
import { WorkbenchHeader } from "@/components/admin/workbench/WorkbenchHeader";
import { WorkbenchStatsOverview } from "@/components/admin/workbench/WorkbenchStatsOverview";
import { WorkbenchFilterBar } from "@/components/admin/workbench/WorkbenchFilterBar";
import { UsersSourcesTab } from "@/components/admin/workbench/UsersSourcesTab";
import { AggregateTab } from "@/components/admin/workbench/AggregateTab";
import { AnalysisTab } from "@/components/admin/workbench/AnalysisTab";
import type { AudioSourceWithProfile, EntityMode, UserProfile } from "@/components/admin/workbench/types";

const AdminWorkbench = () => {
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
  const { users, allSources, signalCounts, dataLoading, fetchAllData, sourceCountByUser, providerKeys } = useWorkbenchData();
  const {
    selectedUserIds,
    selectedSourceIds,
    toggleUserSelection,
    toggleSourceSelection,
    getSourcesByUser,
    getSourcesByProvider,
    selectAllUserSources,
    selectAllProviderSources,
    getTopNeighbors,
  } = useWorkbenchSelection(allSources, allFingerprints);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisResults, setAnalysisResults] = useState<{ sources: any[]; images: any[] } | null>(null);
  const [activeTab, setActiveTab] = useState("users");
  const [filteredUserIds, setFilteredUserIds] = useState<string[]>([]);
  const [filteredProviders, setFilteredProviders] = useState<string[]>([]);
  const [entityMode, setEntityMode] = useState<EntityMode>("user");
  const [filterOpen, setFilterOpen] = useState(false);
  const [expandedGroups, setExpandedGroups] = useState<string[]>([]);
  const [compareMode, setCompareMode] = useState<FingerprintMode>("all");
  const [neighborsOpenFor, setNeighborsOpenFor] = useState<string | null>(null);


  const {
    allSignalPoints,
    signalPoints,
    identifierTagOptions,
    cohorts,
    meta,
    cohortFingerprints,
    signalsLoading,
    cohortCount,
    setCohortCount,
    cohortCountTouched,
    setCohortCountTouched,
    selectedCohortKeys,
    setSelectedCohortKeys,
    toggleCohortFilter,
    identifierFilter,
    setIdentifierFilter,
  } = useIdentifierSignals(entityMode, isAdmin);

  const displayedUsers = filteredUserIds.length > 0
    ? users.filter(u => filteredUserIds.includes(u.user_id))
    : users;

  /** Streamlined list controls for the Users & Sources tab. */
  const [userQuery, setUserQuery] = useState("");
  const [userSort, setUserSort] = useState<"name_asc" | "name_desc" | "sources_desc" | "sources_asc">("name_asc");

  const listedUsers = useMemo(() => {
    const q = userQuery.trim().toLowerCase();
    const list = q
      ? displayedUsers.filter(u =>
          (u.username || "anonymous").toLowerCase().includes(q) ||
          (u.bio || "").toLowerCase().includes(q),
        )
      : [...displayedUsers];
    const name = (u: typeof list[number]) => (u.username || "Anonymous User").toLowerCase();
    list.sort((a, b) => {
      switch (userSort) {
        case "name_desc": return name(b).localeCompare(name(a));
        case "sources_desc": return (sourceCountByUser[b.user_id] || 0) - (sourceCountByUser[a.user_id] || 0);
        case "sources_asc": return (sourceCountByUser[a.user_id] || 0) - (sourceCountByUser[b.user_id] || 0);
        default: return name(a).localeCompare(name(b));
      }
    });
    return list;
  }, [displayedUsers, userQuery, userSort, sourceCountByUser]);


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

  const clearFilters = () => {
    setFilteredUserIds([]);
    setFilteredProviders([]);
    setSelectedCohortKeys([]);
    setIdentifierFilter({ ...EMPTY_IDENTIFIER_FILTER });
  };



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

  if (loading || dataLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="h-16 w-16 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  if (!isAdmin) return null;

  return (
    <div className="relative min-h-screen gradient-app">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-72 opacity-40 blur-3xl"
        style={{ background: "var(--gradient-brand)" }}
      />
      <WorkbenchHeader
        selectedSourceCount={selectedSourceIds.length}
        isAnalyzing={isAnalyzing}
        onAnalyzeSelected={handleAnalyzeSelected}
        onNavigate={navigate}
        onHealthCheck={handleHealthCheck}
        ec2Loading={ec2Loading}
      />

      {/* Stats Overview */}
      <main className="relative mx-auto max-w-7xl px-4 py-6 pb-mobile-nav sm:px-6">

        <WorkbenchStatsOverview
          usersCount={users.length}
          sourcesCount={allSources.length}
          selectedCount={selectedSourceIds.length}
          fingerprintsCount={allFingerprints.length}
        />

        {/* Global meta filter: entity mode + filter picker (applies to all tabs) */}
        <WorkbenchFilterBar
          entityMode={entityMode}
          setEntityMode={setEntityMode}
          filterOpen={filterOpen}
          setFilterOpen={setFilterOpen}
          activeFilterCount={activeFilterCount}
          users={users}
          filteredUserIds={filteredUserIds}
          toggleUserFilter={toggleUserFilter}
          cohorts={cohorts}
          selectedCohortKeys={selectedCohortKeys}
          toggleCohortFilter={toggleCohortFilter}
          providerKeys={providerKeys}
          sourceCountByProvider={(p) => allSources.filter(s => s.source_type === p).length}
          filteredProviders={filteredProviders}
          toggleProviderFilter={toggleProviderFilter}
          clearFilters={clearFilters}
          identifierFilter={identifierFilter}
          setIdentifierFilter={setIdentifierFilter}
          identifierTagOptions={identifierTagOptions}
          signalPointsCount={signalPoints.length}
          allSignalPointsCount={allSignalPoints.length}
        />

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="mb-6 grid h-auto w-full grid-cols-2 gap-1 border border-border/60 bg-card/70 p-1 backdrop-blur-sm sm:flex sm:flex-wrap sm:justify-start">
            <TabsTrigger value="users" className="min-w-0 justify-start gap-1 whitespace-normal px-2 text-[11px] leading-tight sm:justify-center sm:whitespace-nowrap sm:text-xs">
              <Users className="h-3.5 w-3.5 shrink-0" />
              {entityMode === "user"
                ? "Users & Sources"
                : entityMode === "provider"
                  ? "Providers & Signals"
                  : "Cohorts & Identifiers"}
            </TabsTrigger>
            <TabsTrigger value="fingerprints" className="min-w-0 justify-start gap-1 whitespace-normal px-2 text-[11px] leading-tight sm:justify-center sm:whitespace-nowrap sm:text-xs">
              <Fingerprint className="h-3.5 w-3.5 shrink-0" />
              Aggregate
            </TabsTrigger>
            <TabsTrigger value="scope" className="min-w-0 justify-start gap-1 whitespace-normal px-2 text-[11px] leading-tight sm:justify-center sm:whitespace-nowrap sm:text-xs">
              <Activity className="h-3.5 w-3.5 shrink-0" />
              Scope &amp; compare
            </TabsTrigger>
            <TabsTrigger value="analysis" disabled={!analysisResults} className="min-w-0 justify-start gap-1 whitespace-normal px-2 text-[11px] leading-tight sm:justify-center sm:whitespace-nowrap sm:text-xs">
              <Network className="h-3.5 w-3.5 shrink-0" />
              Analysis
            </TabsTrigger>
          </TabsList>


          <TabsContent value="users" className="space-y-4">
            <UsersSourcesTab
              entityMode={entityMode}
              signalPoints={signalPoints}
              cohorts={cohorts}
              meta={meta}
              cohortCount={cohortCount}
              onCohortCountChange={(k) => {
                setCohortCountTouched(true);
                setCohortCount(k);
              }}
              selectedCohortKeys={selectedCohortKeys}
              toggleCohortFilter={toggleCohortFilter}
              signalsLoading={signalsLoading}
              userQuery={userQuery}
              setUserQuery={setUserQuery}
              userSort={userSort}
              setUserSort={setUserSort}
              listedUsers={listedUsers}
              displayedUsers={displayedUsers}
              filteredUserIds={filteredUserIds}
              getSourcesByUser={getSourcesByUser}
              selectedSourceIds={selectedSourceIds}
              selectedUserIds={selectedUserIds}
              expandedGroups={expandedGroups}
              toggleGroup={toggleGroup}
              selectAllUserSources={selectAllUserSources}
              toggleUserSelection={toggleUserSelection}
              allFingerprints={allFingerprints}
              neighborsOpenFor={neighborsOpenFor}
              setNeighborsOpenFor={setNeighborsOpenFor}
              getTopNeighbors={getTopNeighbors}
              renderSourceRow={(source, showOwner) => renderWorkbenchSourceRow({ source, showOwner, selectedSourceIds, toggleSourceSelection, signalCounts })}
              displayedProviders={displayedProviders}
              filteredProviders={filteredProviders}
              getSourcesByProvider={getSourcesByProvider}
              signalCounts={signalCounts}
              selectAllProviderSources={selectAllProviderSources}
            />
          </TabsContent>


          <TabsContent value="fingerprints" className="space-y-6">
            <AggregateTab
              entityMode={entityMode}
              scopedFingerprints={scopedFingerprints}
              signalPointsCount={signalPoints.length}
              activeFilterCount={activeFilterCount}
              allFingerprintsCount={allFingerprints.length}
              fingerprintsLoading={fingerprintsLoading}
              refreshFingerprints={refreshFingerprints}
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

          {/* Scope & compare — the audioscope and the overlay read of the same
              fingerprints, one lens instead of two tabs. */}
          <TabsContent value="scope" className="space-y-6">
            <ScopeCompareLens
              lens="debug"
              fingerprints={scopedFingerprints}
              toScores={(fp, m) => fingerprintToScores(fp, m === "recent" ? "recent" : "all")}
              mode={compareMode === "recent" ? "recent" : "all"}
              onModeChange={(m) => setCompareMode(m as FingerprintMode)}
              entityMode={entityMode as "user" | "signal" | "provider"}
              scopeSummary={
                entityMode === "signal"
                  ? `identifier cohorts • ${scopedFingerprints.length} cohort fingerprint${scopedFingerprints.length !== 1 ? "s" : ""} from ${signalPoints.length.toLocaleString()} identifiers`
                  : activeFilterCount > 0
                    ? `${entityMode === "user" ? "users" : "signal providers"} filter • ${scopedFingerprints.length} of ${allFingerprints.length} fingerprints`
                    : `all ${allFingerprints.length} fingerprints`
              }
              onRefresh={refreshFingerprints}
              refreshing={fingerprintsLoading}
            />
          </TabsContent>

          <TabsContent value="analysis" className="space-y-6">
            <AnalysisTab analysisResults={analysisResults} />
          </TabsContent>

        </Tabs>
      </main>
    </div>

  );
};

export default AdminWorkbench;
