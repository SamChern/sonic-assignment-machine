/**
 * Access Levels portal — one screen where each access level (User, Enterprise,
 * Creator) shows its own dashboard snapshot, recent analyses and the features
 * that only exist behind that level.
 *
 * Personas remain view preferences: every level is browsable, and picking one
 * persists it through `usePersona` so the rest of the app follows.
 */
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  ArrowRight,
  BadgeCheck,
  Building2,
  Check,
  Compass,
  Disc3,
  FileAudio,
  Layers,
  LineChart,
  Megaphone,
  Palette,
  Shield,
  Sparkles,
  Store,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useOrganization } from "@/hooks/useOrganization";
import { usePersona, PERSONAS, type Persona } from "@/hooks/usePersona";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

const ICONS: Record<Persona, typeof Compass> = {
  curious: Compass,
  marketing: Megaphone,
  creator: Palette,
};

interface AnalysisRow {
  id: string;
  source_name: string;
  category: string | null;
  confidence: number;
  originality_score: number | null;
  created_at: string;
  organization_id: string | null;
}

interface PortalData {
  mine: AnalysisRow[];
  org: AnalysisRow[];
  works: number;
  registered: number;
  catalog: number;
  listed: number;
  syncs: { activation_id: string; status: string; profiles_found: number; created_at: string }[];
}

const EMPTY: PortalData = {
  mine: [],
  org: [],
  works: 0,
  registered: 0,
  catalog: 0,
  listed: 0,
  syncs: [],
};

const FEATURES: Record<Persona, { label: string; blurb: string; to: string; icon: typeof Compass }[]> = {
  curious: [
    { label: "Listen & analyse", blurb: "Drop one track, hear what it says about you.", to: "/?tab=listen", icon: FileAudio },
    { label: "My Library", blurb: "Every analysis, faceted and comparable.", to: "/?tab=library", icon: Layers },
    { label: "Sonic Signature", blurb: "Your ensemble archetype, rendered as audio.", to: "/?tab=listen", icon: Sparkles },
  ],
  marketing: [
    { label: "Enterprise workspace", blurb: "Cohorts, activations and predicted performance.", to: "/workspace", icon: Building2 },
    { label: "Semantic analysis", blurb: "Six-category scoring across a whole dataset.", to: "/workspace", icon: LineChart },
    { label: "Ingestion readiness", blurb: "Coverage and match rates before you spend.", to: "/workspace", icon: Check },
  ],
  creator: [
    { label: "Creator door", blurb: "Fingerprint, divergence, lineage.", to: "/creator", icon: Palette },
    { label: "Originality Ledger", blurb: "Register works and set machine-use terms.", to: "/creator", icon: BadgeCheck },
    { label: "Music catalog", blurb: "Labels, albums and tracks with originality rollups.", to: "/library/catalog", icon: Disc3 },
    { label: "Symbol market", blurb: "List catalog tracks with scores attached.", to: "/market", icon: Store },
  ],
};

const Stat = ({ label, value }: { label: string; value: string | number }) => (
  <div className="rounded-lg border border-border/60 bg-card/60 p-3">
    <div className="text-xl font-semibold text-foreground">{value}</div>
    <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
  </div>
);

const AnalysisList = ({ rows, empty }: { rows: AnalysisRow[]; empty: string }) => {
  if (rows.length === 0) {
    return <p className="text-sm text-muted-foreground">{empty}</p>;
  }
  return (
    <ul className="space-y-2">
      {rows.map((r) => (
        <li
          key={r.id}
          className="flex items-center justify-between gap-3 rounded-lg border border-border/60 bg-card/60 px-3 py-2"
        >
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-foreground">{r.source_name}</p>
            <p className="text-xs text-muted-foreground">
              {r.category ?? "uncategorised"} · {new Date(r.created_at).toLocaleDateString()}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {r.originality_score != null && (
              <Badge variant="outline" className="text-xs">
                orig {Math.round(r.originality_score)}
              </Badge>
            )}
            <Badge variant="secondary" className="text-xs">
              {Math.round((r.confidence ?? 0) * 100)}%
            </Badge>
          </div>
        </li>
      ))}
    </ul>
  );
};

const Portal = () => {
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();
  const { persona, setPersona } = usePersona();
  const { orgs, active, loading: orgLoading } = useOrganization();
  const [data, setData] = useState<PortalData>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [tab, setTab] = useState<Persona>(persona ?? "curious");

  useEffect(() => {
    if (persona) setTab(persona);
  }, [persona]);

  useEffect(() => {
    if (authLoading || orgLoading) return;
    let cancelled = false;

    (async () => {
      setLoading(true);
      if (!user) {
        if (!cancelled) {
          setData(EMPTY);
          setIsAdmin(false);
          setLoading(false);
        }
        return;
      }

      const cols = "id, source_name, category, confidence, originality_score, created_at, organization_id";
      const orgId = active?.organization_id ?? null;

      const [mine, org, works, catalog, syncs, roles] = await Promise.all([
        supabase
          .from("source_analyses")
          .select(cols)
          .eq("user_id", user.id)
          .order("created_at", { ascending: false })
          .limit(6),
        orgId
          ? supabase
              .from("source_analyses")
              .select(cols)
              .eq("organization_id", orgId)
              .order("created_at", { ascending: false })
              .limit(6)
          : Promise.resolve({ data: [], error: null } as const),
        supabase.from("creator_works").select("id, registered_at").eq("user_id", user.id),
        supabase.from("catalog_items").select("id, for_sale").eq("user_id", user.id),
        orgId
          ? supabase
              .from("org_intuizi_sync_runs")
              .select("activation_id, status, profiles_found, created_at")
              .eq("organization_id", orgId)
              .order("created_at", { ascending: false })
              .limit(4)
          : Promise.resolve({ data: [], error: null } as const),
        supabase.from("user_roles").select("role").eq("user_id", user.id),
      ]);

      if (cancelled) return;
      const workRows = (works.data ?? []) as { registered_at: string | null }[];
      const catalogRows = (catalog.data ?? []) as { for_sale: boolean }[];

      setData({
        mine: (mine.data ?? []) as AnalysisRow[],
        org: (org.data ?? []) as AnalysisRow[],
        works: workRows.length,
        registered: workRows.filter((w) => w.registered_at).length,
        catalog: catalogRows.length,
        listed: catalogRows.filter((c) => c.for_sale).length,
        syncs: (syncs.data ?? []) as PortalData["syncs"],
      });
      setIsAdmin(((roles.data ?? []) as { role: string }[]).some((r) => r.role === "admin"));
      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [user, authLoading, active?.organization_id, orgLoading]);

  const avgConfidence = useMemo(() => {
    if (data.mine.length === 0) return "—";
    const avg = data.mine.reduce((s, r) => s + (r.confidence ?? 0), 0) / data.mine.length;
    return `${Math.round(avg * 100)}%`;
  }, [data.mine]);

  const enter = async (p: Persona) => {
    await setPersona(p);
    navigate(PERSONAS.find((x) => x.value === p)?.path ?? "/");
  };

  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6 sm:py-10">
      <header className="mb-6">
        <Button variant="ghost" size="sm" asChild className="-ml-2 mb-3 gap-2 text-muted-foreground">
          <Link to="/">
            <ArrowLeft className="h-4 w-4" />
            Back
          </Link>
        </Button>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">Access Levels</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          One house, three doors. Each level keeps its own dashboard, its own analyses and its own tools —
          switch freely, permissions stay tied to your role.
        </p>
      </header>

      <Tabs value={tab} onValueChange={(v) => setTab(v as Persona)}>
        <TabsList className="grid w-full grid-cols-3">
          {PERSONAS.map((p) => {
            const Icon = ICONS[p.value];
            return (
              <TabsTrigger key={p.value} value={p.value} className="gap-2 text-xs sm:text-sm">
                <Icon className="h-4 w-4" />
                <span className="truncate">{p.label}</span>
              </TabsTrigger>
            );
          })}
        </TabsList>

        {PERSONAS.map((p) => (
          <TabsContent key={p.value} value={p.value} className="mt-4 space-y-4">
            <Card className="p-4 sm:p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="text-lg font-semibold text-foreground">{p.label}</h2>
                    {persona === p.value && (
                      <Badge variant="secondary" className="gap-1 text-xs">
                        <Check className="h-3 w-3" /> current
                      </Badge>
                    )}
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">{p.blurb}</p>
                </div>
                <Button size="sm" className="gap-2" onClick={() => void enter(p.value)}>
                  Enter {p.label}
                  <ArrowRight className="h-4 w-4" />
                </Button>
              </div>

              <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
                {loading ? (
                  <>
                    <Skeleton className="h-16" />
                    <Skeleton className="h-16" />
                    <Skeleton className="h-16" />
                  </>
                ) : p.value === "curious" ? (
                  <>
                    <Stat label="My analyses" value={data.mine.length} />
                    <Stat label="Avg confidence" value={avgConfidence} />
                    <Stat label="Signed in" value={user ? "yes" : "guest"} />
                  </>
                ) : p.value === "marketing" ? (
                  <>
                    <Stat label="Organizations" value={orgs.length} />
                    <Stat label="Org analyses" value={data.org.length} />
                    <Stat label="Recent syncs" value={data.syncs.length} />
                  </>
                ) : (
                  <>
                    <Stat label="Works" value={data.works} />
                    <Stat label="Registered" value={data.registered} />
                    <Stat label="Catalog listed" value={`${data.listed}/${data.catalog}`} />
                  </>
                )}
              </div>
            </Card>

            <Card className="p-4 sm:p-5">
              <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                Recent analyses
              </h3>
              {loading ? (
                <Skeleton className="h-20" />
              ) : p.value === "marketing" ? (
                <>
                  <AnalysisList
                    rows={data.org}
                    empty={
                      orgs.length === 0
                        ? "No organization yet — enterprise analyses appear once you join or create one."
                        : "No organization analyses yet."
                    }
                  />
                  {data.syncs.length > 0 && (
                    <ul className="mt-3 space-y-1 border-t border-border/60 pt-3 text-xs text-muted-foreground">
                      {data.syncs.map((s) => (
                        <li key={`${s.activation_id}-${s.created_at}`}>
                          Activation {s.activation_id} · {s.status} · {s.profiles_found} profiles
                        </li>
                      ))}
                    </ul>
                  )}
                </>
              ) : (
                <AnalysisList
                  rows={data.mine}
                  empty={user ? "No analyses yet — run one from Listen." : "Sign in to see your analyses."}
                />
              )}
            </Card>

            <Card className="p-4 sm:p-5">
              <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                {p.label}-only features
              </h3>
              <div className="grid gap-2 sm:grid-cols-2">
                {FEATURES[p.value].map((f) => (
                  <Link
                    key={f.label}
                    to={f.to}
                    className="flex items-start gap-3 rounded-lg border border-border/60 bg-card/60 p-3 transition-colors hover:border-primary/50 hover:bg-accent/40"
                  >
                    <f.icon className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                    <span className="min-w-0">
                      <span className="block text-sm font-medium text-foreground">{f.label}</span>
                      <span className="block text-xs text-muted-foreground">{f.blurb}</span>
                    </span>
                  </Link>
                ))}
              </div>
            </Card>
          </TabsContent>
        ))}
      </Tabs>

      {isAdmin && (
        <Card className="mt-4 flex flex-wrap items-center justify-between gap-3 p-4">
          <div className="flex items-center gap-2">
            <Shield className="h-4 w-4 text-primary" />
            <p className="text-sm text-muted-foreground">
              Admin role detected — the full operator dashboard sits above every access level.
            </p>
          </div>
          <Button size="sm" variant="outline" asChild>
            <Link to="/admin">Admin dashboard</Link>
          </Button>
        </Card>
      )}
    </main>
  );
};

export default Portal;
