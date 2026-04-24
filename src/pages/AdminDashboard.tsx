import { useState, useEffect } from "react";
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
} from "lucide-react";
import { NetworkVisualization } from "@/components/NetworkVisualization";
import { AnalysisResults } from "@/components/AnalysisResults";
import { AggregateNetworkVisualization } from "@/components/AggregateNetworkVisualization";
import { FingerprintComparison } from "@/components/FingerprintComparison";
import { useFingerprints } from "@/hooks/useFingerprints";
import { calculateSimilarity, type FingerprintMode } from "@/lib/fingerprintMath";

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

const AdminDashboard = () => {
  const { user, isAdmin, loading } = useAuth();
  const navigate = useNavigate();
  const { allFingerprints, loading: fingerprintsLoading, refresh: refreshFingerprints } = useFingerprints();
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [allSources, setAllSources] = useState<AudioSourceWithProfile[]>([]);
  const [selectedUserIds, setSelectedUserIds] = useState<string[]>([]);
  const [selectedSourceIds, setSelectedSourceIds] = useState<string[]>([]);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisResults, setAnalysisResults] = useState<{ sources: any[]; images: any[] } | null>(null);
  const [activeTab, setActiveTab] = useState("users");
  const [dataLoading, setDataLoading] = useState(true);
  const [filteredUserIds, setFilteredUserIds] = useState<string[]>([]);
  const [filterOpen, setFilterOpen] = useState(false);
  const [compareMode, setCompareMode] = useState<FingerprintMode>("all");
  const [neighborsOpenFor, setNeighborsOpenFor] = useState<string | null>(null);

  const displayedUsers = filteredUserIds.length > 0 
    ? users.filter(u => filteredUserIds.includes(u.user_id))
    : users;

  const toggleUserFilter = (userId: string) => {
    setFilteredUserIds(prev =>
      prev.includes(userId)
        ? prev.filter(id => id !== userId)
        : [...prev, userId]
    );
  };

  const clearFilters = () => setFilteredUserIds([]);

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

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="mb-6">
            <TabsTrigger value="users" className="gap-2">
              <Users className="h-4 w-4" />
              Users & Sources
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

          <TabsContent value="users" className="space-y-6">
            {/* User Filter */}
            <div className="flex items-center gap-3 flex-wrap">
              <Popover open={filterOpen} onOpenChange={setFilterOpen}>
                <PopoverTrigger asChild>
                  <Button variant="outline" className="gap-2">
                    <Filter className="h-4 w-4" />
                    Filter by User
                    {filteredUserIds.length > 0 && (
                      <Badge variant="secondary" className="ml-1">
                        {filteredUserIds.length}
                      </Badge>
                    )}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-72 p-0 bg-popover" align="start">
                  <Command>
                    <CommandInput placeholder="Search users..." />
                    <CommandList>
                      <CommandEmpty>No users found.</CommandEmpty>
                      <CommandGroup>
                        {users.map(u => (
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
                        ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>

              {/* Filter badges */}
              {filteredUserIds.map(uid => {
                const u = users.find(user => user.user_id === uid);
                if (!u) return null;
                return (
                  <Badge key={uid} variant="secondary" className="gap-1 pr-1">
                    {u.username || 'Anonymous'}
                    <button
                      onClick={() => toggleUserFilter(uid)}
                      className="ml-1 hover:bg-muted rounded-full p-0.5"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </Badge>
                );
              })}

              {filteredUserIds.length > 0 && (
                <Button variant="ghost" size="sm" onClick={clearFilters}>
                  Clear All
                </Button>
              )}
            </div>

            {displayedUsers.length === 0 ? (
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
                
                return (
                  <Card key={userProfile.id} className="p-6 bg-card/80">
                    <div className="flex items-start justify-between mb-4">
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
                      
                      {userSources.length > 0 && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => selectAllUserSources(userProfile.user_id)}
                        >
                          {allSelected ? 'Deselect All' : 'Select All Sources'}
                        </Button>
                      )}
                    </div>

                    {userSources.length > 0 && (
                      <div className="grid gap-2 ml-10">
                        {userSources.map(source => (
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
                              <img
                                src={source.album_image}
                                alt={source.name}
                                className="w-10 h-10 rounded"
                              />
                            ) : (
                              <FileAudio className="w-10 h-10 text-muted-foreground p-2" />
                            )}
                            <div className="flex-1 min-w-0">
                              <p className="font-medium text-foreground truncate">{source.name}</p>
                              {source.artists && (
                                <p className="text-sm text-muted-foreground truncate">
                                  {source.artists.join(', ')}
                                </p>
                              )}
                            </div>
                            <Badge variant="outline" className="text-xs">
                              {source.source_type}
                            </Badge>
                          </div>
                        ))}
                      </div>
                    )}
                  </Card>
                );
              })
            )}
          </TabsContent>

          <TabsContent value="fingerprints" className="space-y-6">
            <div className="flex justify-between items-center">
              <div>
                <h3 className="text-lg font-semibold text-foreground">Aggregate User Fingerprints</h3>
                <p className="text-sm text-muted-foreground">
                  Each bubble represents a user's combined ontological fingerprint
                </p>
              </div>
              <Button variant="outline" size="sm" onClick={refreshFingerprints} disabled={fingerprintsLoading}>
                {fingerprintsLoading ? 'Loading...' : 'Refresh'}
              </Button>
            </div>
            <AggregateNetworkVisualization 
              fingerprints={allFingerprints}
              onUserClick={(userId) => {
                setFilteredUserIds([userId]);
                setActiveTab("users");
              }}
            />
          </TabsContent>

          <TabsContent value="compare" className="space-y-6">
            <div className="flex justify-between items-center">
              <div>
                <h3 className="text-lg font-semibold text-foreground">Compare User Fingerprints</h3>
                <p className="text-sm text-muted-foreground">
                  Select 2 or more users to overlay their radar charts side-by-side
                </p>
              </div>
              <Button variant="outline" size="sm" onClick={refreshFingerprints} disabled={fingerprintsLoading}>
                {fingerprintsLoading ? 'Loading...' : 'Refresh'}
              </Button>
            </div>
            <FingerprintComparison fingerprints={allFingerprints} />
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