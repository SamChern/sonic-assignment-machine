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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { 
  Users, 
  Music, 
  Network, 
  ArrowLeft, 
  Sparkles,
  User,
  FileAudio,
  Shield,
  ShieldCheck,
  Trash2
} from "lucide-react";
import { NetworkVisualization } from "@/components/NetworkVisualization";
import { AnalysisResults } from "@/components/AnalysisResults";
import type { Database } from "@/integrations/supabase/types";

type AppRole = Database["public"]["Enums"]["app_role"];

interface UserProfile {
  id: string;
  user_id: string;
  username: string | null;
  avatar_url: string | null;
  bio: string | null;
  created_at: string;
}

interface UserRole {
  id: string;
  user_id: string;
  role: AppRole;
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
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [userRoles, setUserRoles] = useState<UserRole[]>([]);
  const [allSources, setAllSources] = useState<AudioSourceWithProfile[]>([]);
  const [selectedUserIds, setSelectedUserIds] = useState<string[]>([]);
  const [selectedSourceIds, setSelectedSourceIds] = useState<string[]>([]);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisResults, setAnalysisResults] = useState<{ sources: any[]; images: any[] } | null>(null);
  const [activeTab, setActiveTab] = useState("users");
  const [dataLoading, setDataLoading] = useState(true);

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

    // Fetch all user roles
    const { data: rolesData } = await supabase
      .from('user_roles')
      .select('*');
    
    setUserRoles(rolesData || []);

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

  const getUserRoles = (userId: string): AppRole[] => {
    return userRoles.filter(r => r.user_id === userId).map(r => r.role);
  };

  const assignRole = async (userId: string, role: AppRole) => {
    const existingRole = userRoles.find(r => r.user_id === userId && r.role === role);
    if (existingRole) {
      toast.info(`User already has ${role} role`);
      return;
    }

    const { error } = await supabase
      .from('user_roles')
      .insert({ user_id: userId, role });

    if (error) {
      toast.error(`Failed to assign role: ${error.message}`);
      return;
    }

    toast.success(`Assigned ${role} role successfully`);
    fetchAllData();
  };

  const removeRole = async (userId: string, role: AppRole) => {
    const { error } = await supabase
      .from('user_roles')
      .delete()
      .eq('user_id', userId)
      .eq('role', role);

    if (error) {
      toast.error(`Failed to remove role: ${error.message}`);
      return;
    }

    toast.success(`Removed ${role} role successfully`);
    fetchAllData();
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
            <TabsTrigger value="roles" className="gap-2">
              <Shield className="h-4 w-4" />
              Role Management
            </TabsTrigger>
            <TabsTrigger value="analysis" className="gap-2" disabled={!analysisResults}>
              <Network className="h-4 w-4" />
              Cross-User Analysis
            </TabsTrigger>
          </TabsList>

          <TabsContent value="users" className="space-y-6">
            {users.length === 0 ? (
              <Card className="p-8 text-center">
                <Users className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
                <p className="text-lg text-muted-foreground">No users yet</p>
              </Card>
            ) : (
              users.map(userProfile => {
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

          <TabsContent value="roles" className="space-y-6">
            <Card className="p-6 bg-card/80">
              <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
                <ShieldCheck className="h-5 w-5 text-primary" />
                Manage User Roles
              </h3>
              <p className="text-sm text-muted-foreground mb-6">
                Assign or remove admin and moderator roles for users.
              </p>
              
              <div className="space-y-4">
                {users.map(userProfile => {
                  const roles = getUserRoles(userProfile.user_id);
                  
                  return (
                    <div
                      key={userProfile.id}
                      className="flex items-center justify-between p-4 rounded-lg border border-border bg-secondary/20"
                    >
                      <div className="flex items-center gap-4">
                        <Avatar className="h-10 w-10">
                          <AvatarImage src={userProfile.avatar_url || undefined} />
                          <AvatarFallback>
                            <User className="h-5 w-5" />
                          </AvatarFallback>
                        </Avatar>
                        <div>
                          <p className="font-medium text-foreground">
                            {userProfile.username || 'Anonymous User'}
                          </p>
                          <div className="flex gap-1 mt-1">
                            {roles.length === 0 ? (
                              <Badge variant="outline" className="text-xs">No roles</Badge>
                            ) : (
                              roles.map(role => (
                                <Badge
                                  key={role}
                                  variant={role === 'admin' ? 'default' : 'secondary'}
                                  className={role === 'admin' ? 'bg-primary' : ''}
                                >
                                  {role}
                                </Badge>
                              ))
                            )}
                          </div>
                        </div>
                      </div>
                      
                      <div className="flex items-center gap-2">
                        <Select
                          onValueChange={(value) => assignRole(userProfile.user_id, value as AppRole)}
                        >
                          <SelectTrigger className="w-[140px]">
                            <SelectValue placeholder="Add role..." />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="admin">Admin</SelectItem>
                            <SelectItem value="moderator">Moderator</SelectItem>
                            <SelectItem value="user">User</SelectItem>
                          </SelectContent>
                        </Select>
                        
                        {roles.map(role => (
                          <Button
                            key={role}
                            variant="ghost"
                            size="sm"
                            className="text-destructive hover:text-destructive hover:bg-destructive/10"
                            onClick={() => removeRole(userProfile.user_id, role)}
                          >
                            <Trash2 className="h-4 w-4 mr-1" />
                            Remove {role}
                          </Button>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </Card>
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