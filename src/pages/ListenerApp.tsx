/**
 * The standalone Listener app: one mobile-first screen that takes a visitor
 * from sign-up, through membership, to reading their own sounds. Deliberately
 * separate from the main site chrome so it feels like its own small app.
 */
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Headphones, Library, Loader2, RefreshCw, Sparkles, User } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useListenerSpace } from "@/hooks/useListenerSpace";
import { useListenerSubscription } from "@/hooks/useListenerSubscription";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import ThemeToggle from "@/components/ThemeToggle";
import ListenerJoinStep from "@/components/listener/ListenerJoinStep";
import ListenerPlanStep from "@/components/listener/ListenerPlanStep";
import ListenerUploadPanel from "@/components/listener/ListenerUploadPanel";
import ListenerScoreCard from "@/components/listener/ListenerScoreCard";

type Tab = "listen" | "library" | "account";

const TABS: { id: Tab; label: string; icon: typeof Headphones }[] = [
  { id: "listen", label: "Listen", icon: Headphones },
  { id: "library", label: "Library", icon: Library },
  { id: "account", label: "Account", icon: User },
];

const ListenerApp = () => {
  const { user, loading: authLoading, signOut } = useAuth();
  const space = useListenerSpace();
  const {
    membership,
    loading: membershipLoading,
    awaitingPayment,
    claimPending,
    reload,
  } = useListenerSubscription(user?.id ?? null);
  const [tab, setTab] = useState<Tab>("listen");

  const stage = useMemo(() => {
    if (!user) return "join" as const;
    if (!membership || awaitingPayment) return "plan" as const;
    return "app" as const;
  }, [user, membership, awaitingPayment]);

  if (authLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center gradient-app">
        <Loader2 className="h-6 w-6 animate-spin text-primary" aria-hidden="true" />
      </div>
    );
  }

  const header = (
    <header className="sticky top-0 z-20 border-b border-border/60 bg-card/85 backdrop-blur-md">
      <div className="mx-auto flex max-w-md items-center gap-2 px-4 py-3">
        <Sparkles className="h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-foreground">SonicSIM Listener</p>
          <p className="truncate text-[11px] text-muted-foreground">
            Hear what your sound is really saying
          </p>
        </div>
        <div className="ml-auto">
          <ThemeToggle />
        </div>
      </div>
    </header>
  );

  return (
    <div className="min-h-screen gradient-app">
      {header}

      <main className="mx-auto max-w-md space-y-4 px-4 py-5 pb-28">
        {stage === "join" && (
          <>
            <Card className="p-4">
              <h1 className="text-lg font-semibold text-foreground">
                Read any sound on six dimensions
              </h1>
              <p className="mt-1 text-sm text-muted-foreground">
                Add a track or a recording and see what it carries: feeling, thought, people,
                message, setting and craft. Your readings stay private to you.
              </p>
            </Card>
            <ListenerJoinStep onSignedIn={() => void reload()} />
            <p className="text-center text-xs text-muted-foreground">
              Making something for a living?{" "}
              <Link to="/creator/apply" className="text-primary hover:underline">
                Apply as a Creator
              </Link>
            </p>
          </>
        )}

        {stage === "plan" &&
          (membershipLoading ? (
            <Card className="p-6 text-center text-sm text-muted-foreground">
              Checking your membership…
            </Card>
          ) : (
            <ListenerPlanStep
              email={user?.email ?? null}
              awaitingPayment={awaitingPayment}
              onChoose={async (period) => {
                await claimPending(user?.email ?? null, false, period);
              }}
            />
          ))}

        {stage === "app" && (
          <>
            {tab === "listen" && (
              <>
                <ListenerUploadPanel onAnalysed={() => void space.refresh()} />
                {space.latest && (
                  <ListenerScoreCard
                    title={space.latest.source_name ?? "Your most recent sound"}
                    caption={`Read ${new Date(space.latest.created_at).toLocaleString()}`}
                    scores={space.latestScores}
                    confidence={space.latest.confidence}
                    grounding={space.latest.grounding_level}
                  />
                )}
                {space.analysedCount > 1 && (
                  <ListenerScoreCard
                    title="Your average shape"
                    caption={`Across ${space.analysedCount} sounds`}
                    scores={space.averages}
                  />
                )}
              </>
            )}

            {tab === "library" && (
              <Card className="p-4">
                <div className="mb-2 flex items-center gap-2">
                  <h2 className="text-sm font-semibold text-foreground">Your readings</h2>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="ml-auto h-8"
                    onClick={() => void space.refresh()}
                    disabled={space.loading}
                  >
                    <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
                    <span className="sr-only">Refresh your readings</span>
                  </Button>
                </div>
                {space.loading ? (
                  <p className="text-sm text-muted-foreground">Loading…</p>
                ) : space.analysedCount === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    Nothing read yet. Add a sound on the Listen tab.
                  </p>
                ) : (
                  <ul className="divide-y divide-border/50">
                    {space.analyses.map((a) => (
                      <li key={a.id} className="flex items-center gap-2 py-2.5 text-xs">
                        <span className="min-w-0 flex-1 truncate text-foreground">
                          {a.source_name ?? "Untitled sound"}
                        </span>
                        {a.grounding_level && (
                          <Badge variant="outline" className="px-1 py-0 text-[10px]">
                            {a.grounding_level.replace(/_/g, " ")}
                          </Badge>
                        )}
                        <span className="shrink-0 text-muted-foreground">
                          {new Date(a.created_at).toLocaleDateString()}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            )}

            {tab === "account" && (
              <Card className="space-y-3 p-4">
                <h2 className="text-sm font-semibold text-foreground">Your membership</h2>
                <dl className="space-y-1.5 text-xs">
                  <div className="flex gap-2">
                    <dt className="text-muted-foreground">Email</dt>
                    <dd className="ml-auto truncate text-foreground">{user?.email}</dd>
                  </div>
                  <div className="flex gap-2">
                    <dt className="text-muted-foreground">Plan</dt>
                    <dd className="ml-auto text-foreground">
                      {membership?.billing_period === "annual" ? "$29.99 a year" : "$2.99 a month"}
                    </dd>
                  </div>
                  <div className="flex gap-2">
                    <dt className="text-muted-foreground">Status</dt>
                    <dd className="ml-auto text-foreground">
                      {membership?.status === "active" ? "Active" : "Waiting on payment"}
                    </dd>
                  </div>
                  <div className="flex gap-2">
                    <dt className="text-muted-foreground">Sounds read</dt>
                    <dd className="ml-auto text-foreground">{space.analysedCount}</dd>
                  </div>
                </dl>
                <Button
                  variant="outline"
                  className="min-h-11 w-full"
                  onClick={() => void signOut()}
                >
                  Sign out
                </Button>
              </Card>
            )}
          </>
        )}
      </main>

      {stage === "app" && (
        <nav
          aria-label="Listener sections"
          className="fixed inset-x-0 bottom-0 z-30 border-t border-border/60 bg-card/95 backdrop-blur-md"
        >
          <ul className="mx-auto flex max-w-md">
            {TABS.map(({ id, label, icon: Icon }) => (
              <li key={id} className="flex-1">
                <button
                  type="button"
                  onClick={() => setTab(id)}
                  aria-current={tab === id ? "page" : undefined}
                  className={`flex min-h-14 w-full flex-col items-center justify-center gap-1 text-[11px] ${
                    tab === id ? "text-primary" : "text-muted-foreground"
                  }`}
                >
                  <Icon className="h-5 w-5" aria-hidden="true" />
                  {label}
                </button>
              </li>
            ))}
          </ul>
        </nav>
      )}
    </div>
  );
};

export default ListenerApp;
