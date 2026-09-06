import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Loader2, RefreshCw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useAudioSources } from "@/hooks/useAudioSources";
import { useCreatorSpace } from "@/hooks/useCreatorSpace";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CreatorNav } from "@/components/creator/CreatorNav";
import CreatorLibraryPanel from "@/components/creator/CreatorLibraryPanel";
import CreatorProfilePanel from "@/components/creator/CreatorProfilePanel";
import CreatorAnalyticsPanel from "@/components/creator/CreatorAnalyticsPanel";
import CreatorUploadPanel from "@/components/creator/CreatorUploadPanel";

/**
 * The Creator space: the same three things a Listener gets — their library,
 * their profile and their results — scoped to a creator's own account.
 */
const CreatorSpace = () => {
  const { user, loading: authLoading } = useAuth();
  const { mySources, loading: sourcesLoading, refresh: refreshSources } = useAudioSources();
  const space = useCreatorSpace();
  const [profile, setProfile] = useState<{ username: string | null; avatar_url: string | null } | null>(
    null,
  );

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    void supabase
      .from("profiles")
      .select("username,avatar_url")
      .eq("user_id", user.id)
      .maybeSingle()
      .then(({ data }) => {
        if (!cancelled) setProfile((data as typeof profile) ?? null);
      });
    return () => {
      cancelled = true;
    };
  }, [user]);

  if (authLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center gradient-app">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="mx-auto max-w-md px-4 py-16">
        <Card className="space-y-3 p-6 text-center">
          <h1 className="text-lg font-semibold text-foreground">Sign in to open your space</h1>
          <p className="text-sm text-muted-foreground">
            Your sounds, your terms and your results all stay tied to your account.
          </p>
          <Button asChild>
            <Link to="/auth?next=%2Fcreator%2Fspace">Sign in or create an account</Link>
          </Button>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen gradient-app">
      <div className="mx-auto max-w-5xl space-y-4 px-4 py-6 pb-mobile-nav sm:px-6">
        <CreatorNav />

        <div className="flex flex-wrap items-center gap-2">
          <div>
            <h1 className="text-lg font-semibold text-foreground">Your Creator space</h1>
            <p className="text-xs text-muted-foreground">
              Everything you have added, how it reads, and the terms you set.
            </p>
          </div>
          <Button
            size="sm"
            variant="outline"
            className="ml-auto"
            onClick={() => void space.refresh()}
            disabled={space.loading}
          >
            <RefreshCw className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
            Refresh
          </Button>
        </div>

        <Tabs defaultValue="library">
          <TabsList className="grid w-full grid-cols-3 border border-border/60 bg-card/70 p-1 backdrop-blur-sm">
            <TabsTrigger value="library" className="text-xs sm:text-sm">
              Library
            </TabsTrigger>
            <TabsTrigger value="profile" className="text-xs sm:text-sm">
              Profile
            </TabsTrigger>
            <TabsTrigger value="results" className="text-xs sm:text-sm">
              Results
            </TabsTrigger>
          </TabsList>

          <TabsContent value="library" className="mt-4 space-y-4">
            <CreatorUploadPanel
              onAdded={async () => {
                await Promise.all([refreshSources(), space.refresh()]);
              }}
            />
            <CreatorLibraryPanel
              sources={mySources}
              analyses={space.analyses}
              loading={sourcesLoading || space.loading}
            />
          </TabsContent>


          <TabsContent value="profile" className="mt-4">
            <CreatorProfilePanel
              name={profile?.username ?? user.email ?? "Your account"}
              avatarUrl={profile?.avatar_url}
              soundCount={mySources.length}
              analysedCount={space.analysedCount}
              registeredCount={space.registeredCount}
              sharedCount={space.sharedCount}
              works={space.works}
            />
          </TabsContent>

          <TabsContent value="results" className="mt-4">
            <CreatorAnalyticsPanel space={space} />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
};

export default CreatorSpace;
