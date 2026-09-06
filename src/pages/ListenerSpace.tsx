import { Link } from "react-router-dom";
import { Loader2, RefreshCw } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useAudioSources } from "@/hooks/useAudioSources";
import { useListenerSpace } from "@/hooks/useListenerSpace";
import { useListenerSubscription } from "@/hooks/useListenerSubscription";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import ListenerUploadPanel from "@/components/listener/ListenerUploadPanel";
import ListenerScoreCard from "@/components/listener/ListenerScoreCard";
import ListenerPaymentPending from "@/components/home/ListenerPaymentPending";

/**
 * The Listener space: upload a sound, have it read on the six dimensions, and
 * see the result on a dashboard alongside everything read before.
 */
const ListenerSpace = () => {
  const { user, loading: authLoading } = useAuth();
  const { mySources, loading: sourcesLoading, refresh: refreshSources } = useAudioSources();
  const space = useListenerSpace();
  const { membership } = useListenerSubscription(user?.id ?? null);

  const locked = membership?.status === "awaiting_payment";

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
          <h1 className="text-lg font-semibold text-foreground">Sign in to open your dashboard</h1>
          <p className="text-sm text-muted-foreground">
            Every sound you have read, and what it says, stays tied to your account.
          </p>
          <Button asChild>
            <Link to="/auth?next=%2Flistener">Sign in or create an account</Link>
          </Button>
        </Card>
      </div>
    );
  }

  const refreshAll = async () => {
    await Promise.all([refreshSources(), space.refresh()]);
  };

  return (
    <div className="min-h-screen gradient-app">
      <div className="mx-auto max-w-4xl space-y-4 px-4 py-6 pb-mobile-nav sm:px-6">
        <div className="flex flex-wrap items-center gap-2">
          <div className="min-w-0">
            <h1 className="text-lg font-semibold text-foreground">Your listening dashboard</h1>
            <p className="text-xs text-muted-foreground">
              Add a sound, see its six scores, and watch your own shape build up.
            </p>
          </div>
          <Button
            size="sm"
            variant="outline"
            className="ml-auto"
            onClick={() => void refreshAll()}
            disabled={space.loading}
          >
            <RefreshCw className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
            Refresh
          </Button>
        </div>

        {locked ? (
          <ListenerPaymentPending />
        ) : (
          <Tabs defaultValue="analyse">
            <TabsList className="grid w-full grid-cols-3 border border-border/60 bg-card/70 p-1 backdrop-blur-sm">
              <TabsTrigger value="analyse" className="text-xs sm:text-sm">
                Add a sound
              </TabsTrigger>
              <TabsTrigger value="dashboard" className="text-xs sm:text-sm">
                Dashboard
              </TabsTrigger>
              <TabsTrigger value="library" className="text-xs sm:text-sm">
                Library
              </TabsTrigger>
            </TabsList>

            <TabsContent value="analyse" className="mt-4 space-y-4">
              <ListenerUploadPanel onAnalysed={refreshAll} />
              {space.latest && (
                <ListenerScoreCard
                  title={space.latest.source_name ?? "Your most recent sound"}
                  caption={`Read ${new Date(space.latest.created_at).toLocaleString()}`}
                  scores={space.latestScores}
                  confidence={space.latest.confidence}
                  grounding={space.latest.grounding_level}
                />
              )}
            </TabsContent>

            <TabsContent value="dashboard" className="mt-4 space-y-4">
              {space.loading ? (
                <Card className="p-6 text-center text-sm text-muted-foreground">
                  Loading your results…
                </Card>
              ) : space.analysedCount === 0 ? (
                <Card className="p-6 text-center text-sm text-muted-foreground">
                  Nothing read yet. Add a sound and its scores appear here straight away.
                </Card>
              ) : (
                <>
                  <ListenerScoreCard
                    title="Your average shape"
                    caption={`Across ${space.analysedCount} ${space.analysedCount === 1 ? "sound" : "sounds"}`}
                    scores={space.averages}
                  />
                  {space.strongest && space.quietest && (
                    <Card className="p-4 text-xs text-muted-foreground">
                      What you listen to leans most on{" "}
                      <span className="text-foreground">{space.strongest.name}</span> and least on{" "}
                      <span className="text-foreground">{space.quietest.name}</span>.
                    </Card>
                  )}
                  <Card className="p-4">
                    <h2 className="mb-2 text-sm font-semibold text-foreground">Recent readings</h2>
                    <ul className="divide-y divide-border/50">
                      {space.analyses.slice(0, 10).map((a) => (
                        <li key={a.id} className="flex flex-wrap items-center gap-2 py-2 text-xs">
                          <span className="min-w-0 flex-1 truncate text-foreground">
                            {a.source_name ?? "Untitled sound"}
                          </span>
                          {a.grounding_level && (
                            <Badge variant="outline" className="px-1 py-0 text-[10px]">
                              {a.grounding_level.replace(/_/g, " ")}
                            </Badge>
                          )}
                          <span className="text-muted-foreground">
                            {new Date(a.created_at).toLocaleDateString()}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </Card>
                </>
              )}
            </TabsContent>

            <TabsContent value="library" className="mt-4">
              <Card className="p-4">
                <h2 className="mb-2 text-sm font-semibold text-foreground">Your sounds</h2>
                {sourcesLoading ? (
                  <p className="text-sm text-muted-foreground">Loading your sounds…</p>
                ) : mySources.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    Nothing here yet. Anything you add shows up in this list.
                  </p>
                ) : (
                  <ul className="divide-y divide-border/50">
                    {mySources.slice(0, 100).map((s) => {
                      const read = space.analyses.some((a) => a.audio_source_id === s.id);
                      return (
                        <li key={s.id} className="flex items-center gap-2 py-2 text-xs">
                          <span className="min-w-0 flex-1 truncate text-foreground">{s.name}</span>
                          <Badge
                            variant={read ? "secondary" : "outline"}
                            className="px-1 py-0 text-[10px]"
                          >
                            {read ? "read" : "not read yet"}
                          </Badge>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </Card>
            </TabsContent>
          </Tabs>
        )}
      </div>
    </div>
  );
};

export default ListenerSpace;
