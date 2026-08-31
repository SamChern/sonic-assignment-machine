import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import {
  ArrowLeft,
  BadgeCheck,
  FileAudio,
  History,
  Library,
  ListChecks,
  Loader2,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useAudioSources } from "@/hooks/useAudioSources";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { LibraryFacetBar } from "@/components/library/LibraryFacetBar";
import { EMPTY_FILTER, groupLibrary, type FacetFilter } from "@/lib/libraryFacets";

interface LedgerEvent {
  id: string;
  event_type: string;
  created_at: string;
  payload: Record<string, unknown> | null;
  work_id: string;
}

interface WorkRow {
  id: string;
  title: string;
  machine_use_terms: string;
  registered_at: string | null;
  withdrawn_at: string | null;
}

interface QueuedSymbol {
  id: string;
  symbol: string;
  symbol_type: string;
  status: string;
  sightings: number;
  attempts: number;
  last_seen_at: string;
}

const when = (iso: string) => new Date(iso).toLocaleString();

/**
 * Creator profile: who you are here, the library you brought, the registration
 * history the Originality Ledger recorded, and the symbols your work queued.
 */
export default function CreatorProfile() {
  const { user, loading: authLoading } = useAuth();
  const { mySources, loading: sourcesLoading } = useAudioSources();
  const [profile, setProfile] = useState<{ username: string | null; avatar_url: string | null } | null>(null);
  const [works, setWorks] = useState<WorkRow[]>([]);
  const [events, setEvents] = useState<LedgerEvent[]>([]);
  const [queued, setQueued] = useState<QueuedSymbol[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<FacetFilter>(EMPTY_FILTER);

  const library = useMemo(() => groupLibrary(mySources, filter), [mySources, filter]);

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const [p, w, l, q] = await Promise.all([
        supabase.from("profiles").select("username, avatar_url").eq("user_id", user.id).maybeSingle(),
        supabase
          .from("creator_works")
          .select("id, title, machine_use_terms, registered_at, withdrawn_at")
          .order("created_at", { ascending: false }),
        supabase
          .from("originality_ledger")
          .select("id, event_type, created_at, payload, work_id")
          .order("created_at", { ascending: false })
          .limit(60),
        supabase.rpc("creator_queued_symbols"),
      ]);
      setProfile((p.data as typeof profile) ?? null);
      setWorks((w.data ?? []) as WorkRow[]);
      setEvents((l.data ?? []) as LedgerEvent[]);
      setQueued((q.data ?? []) as QueuedSymbol[]);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    void load();
  }, [load]);

  const titleFor = (workId: string) => works.find((w) => w.id === workId)?.title ?? "—";
  const registered = works.filter((w) => w.registered_at && !w.withdrawn_at).length;
  const byStatus = useMemo(() => {
    const map: Record<string, number> = {};
    for (const q of queued) map[q.status] = (map[q.status] ?? 0) + 1;
    return map;
  }, [queued]);

  if (authLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="mx-auto max-w-md px-4 py-16">
        <Card className="space-y-3 p-6 text-center">
          <h1 className="text-lg font-semibold">Sign in to see your creator profile</h1>
          <p className="text-sm text-muted-foreground">
            Your library, registrations and queued symbols are tied to your account.
          </p>
          <Button asChild>
            <Link to="/auth?mode=signup">Sign in or create an account</Link>
          </Button>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-5xl space-y-4 px-4 py-6">
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="ghost" className="h-8" asChild>
            <Link to="/creator">
              <ArrowLeft className="mr-1 h-4 w-4" /> Creator
            </Link>
          </Button>
          <h1 className="text-lg font-semibold">Creator profile</h1>
        </div>

        <Card className="flex flex-wrap items-center gap-3 p-4">
          <Avatar className="h-12 w-12">
            <AvatarImage src={profile?.avatar_url ?? undefined} alt="" />
            <AvatarFallback>
              {(profile?.username ?? user.email ?? "?").slice(0, 2).toUpperCase()}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <p className="truncate font-medium">{profile?.username ?? user.email}</p>
            <p className="text-xs text-muted-foreground">
              {mySources.length} sources · {registered} registered works · {queued.length} queued symbols
            </p>
          </div>
          <div className="ml-auto flex flex-wrap gap-1">
            {Object.entries(byStatus).map(([s, n]) => (
              <Badge key={s} variant="outline" className="text-[10px]">
                {s} {n}
              </Badge>
            ))}
          </div>
        </Card>

        <Tabs defaultValue="library">
          <TabsList>
            <TabsTrigger value="library" className="gap-1 text-xs">
              <Library className="h-3.5 w-3.5" /> Library
            </TabsTrigger>
            <TabsTrigger value="history" className="gap-1 text-xs">
              <History className="h-3.5 w-3.5" /> Registrations
            </TabsTrigger>
            <TabsTrigger value="symbols" className="gap-1 text-xs">
              <ListChecks className="h-3.5 w-3.5" /> Queued symbols
            </TabsTrigger>
          </TabsList>

          <TabsContent value="library" className="space-y-3 pt-3">
            <LibraryFacetBar filter={filter} counts={library.counts} onChange={setFilter} />
            {sourcesLoading ? (
              <Card className="p-6 text-center">
                <Loader2 className="mx-auto h-5 w-5 animate-spin text-primary" />
              </Card>
            ) : library.total === 0 ? (
              <Card className="p-6 text-center text-sm text-muted-foreground">
                No sources match these filters.
              </Card>
            ) : (
              library.groups.map((g) => (
                <Card key={g.provider} className="space-y-2 p-3">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    {g.label}
                    <Badge variant="secondary" className="text-xs">{g.sources.length}</Badge>
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {g.sources.slice(0, 40).map((s) => (
                      <div
                        key={s.id}
                        className="flex items-center gap-2 rounded-md bg-secondary/20 p-2"
                      >
                        <FileAudio className="h-4 w-4 flex-shrink-0 text-primary" />
                        <span className="truncate text-xs">{s.name}</span>
                      </div>
                    ))}
                  </div>
                </Card>
              ))
            )}
          </TabsContent>

          <TabsContent value="history" className="space-y-2 pt-3">
            {loading ? (
              <Card className="p-6 text-center">
                <Loader2 className="mx-auto h-5 w-5 animate-spin text-primary" />
              </Card>
            ) : events.length === 0 ? (
              <Card className="p-6 text-center text-sm text-muted-foreground">
                No registration events yet. Register a work from the Creator door.
              </Card>
            ) : (
              <Card className="divide-y divide-border/50">
                {events.map((e) => (
                  <div key={e.id} className="flex flex-wrap items-center gap-2 px-3 py-2">
                    <BadgeCheck className="h-3.5 w-3.5 text-primary" />
                    <span className="text-xs font-medium">{e.event_type.replace(/_/g, " ")}</span>
                    <span className="truncate text-xs text-muted-foreground">
                      {titleFor(e.work_id)}
                    </span>
                    <span className="ml-auto text-[10px] text-muted-foreground">
                      {when(e.created_at)}
                    </span>
                  </div>
                ))}
              </Card>
            )}
          </TabsContent>

          <TabsContent value="symbols" className="space-y-2 pt-3">
            {queued.length === 0 ? (
              <Card className="p-6 text-center text-sm text-muted-foreground">
                Nothing queued from your work right now.
              </Card>
            ) : (
              <Card className="divide-y divide-border/50">
                {queued.map((q) => (
                  <div key={q.id} className="flex flex-wrap items-center gap-2 px-3 py-2">
                    <span className="font-mono text-[11px] text-primary">{q.symbol}</span>
                    <Badge variant="outline" className="px-1 py-0 text-[9px]">{q.symbol_type}</Badge>
                    <Badge
                      variant={q.status === "resolved" ? "secondary" : "outline"}
                      className="px-1 py-0 text-[9px]"
                    >
                      {q.status}
                    </Badge>
                    <span className="text-[10px] text-muted-foreground">
                      {q.sightings} sightings · {q.attempts} attempts
                    </span>
                    <span className="ml-auto text-[10px] text-muted-foreground">
                      {when(q.last_seen_at)}
                    </span>
                  </div>
                ))}
              </Card>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
