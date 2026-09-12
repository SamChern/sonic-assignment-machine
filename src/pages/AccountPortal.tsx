/**
 * Per-account portal — one landing page per enterprise account.
 *
 * Analysts get their own dashboard for the account they belong to: plan, role,
 * datasets, saved analyses, the feeds granted to them, what changed since
 * yesterday and shortcuts into the sections their access switches allow. It
 * never links to the shared platform admin screens.
 *
 * Reached at /portal/<account slug> (the account id also works). Membership is
 * enforced by the database: the org list only contains accounts you belong to.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useOrganization, type OrgMembership } from "@/hooks/useOrganization";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import ThemeToggle from "@/components/ThemeToggle";
import { PanelErrorBoundary } from "@/components/PanelErrorBoundary";
import WorkspaceDigestCard from "@/components/enterprise/WorkspaceDigestCard";
import type { CapabilityKey } from "@/lib/orgCapabilities";
import sonicSimLogo from "@/assets/SonicSIM_transp.png";
import {
  Activity,
  ArrowLeft,
  ArrowRight,
  Building2,
  Compass,
  Layers,
  LineChart,
  Radio,
  RefreshCw,
  Sparkles,
  Tag,
  Target,
  Upload,
} from "lucide-react";

interface AnalysisRow {
  id: string;
  source_name: string;
  category: string | null;
  created_at: string;
  confidence: number | null;
}

/** Shortcuts into the workspace, each behind the switch that section needs. */
const SHORTCUTS: {
  tab: string;
  label: string;
  blurb: string;
  icon: typeof Upload;
  needs?: CapabilityKey;
  gradient: string;
}[] = [
  {
    tab: "analyses",
    label: "Analyses",
    blurb: "Every track this account has scored, with its six categories.",
    icon: Sparkles,
    gradient: "var(--gradient-emotional)",
  },
  {
    tab: "data",
    label: "Your data",
    blurb: "Upload files and check what landed from your feeds.",
    icon: Upload,
    gradient: "var(--gradient-contextual)",
  },
  {
    tab: "enrich",
    label: "Enrichment",
    blurb: "What SonicSIM adds to your device rows, and how sure it is.",
    icon: Layers,
    needs: "enrichment_preview",
    gradient: "var(--gradient-social)",
  },
  {
    tab: "sonicsim",
    label: "See my SonicSIM",
    blurb: "Play your fingerprint, and performance by channel or genre.",
    icon: Activity,
    needs: "semantic_model",
    gradient: "var(--gradient-artistic)",
  },
  {
    tab: "users",
    label: "Find an audience",
    blurb: "Describe who you want; get a sonic profile you can refine.",
    icon: Target,
    needs: "predict_users",
    gradient: "var(--gradient-cognitive)",
  },
  {
    tab: "outcomes",
    label: "Predict performance",
    blurb: "Score creative against outcomes your own data has seen.",
    icon: LineChart,
    needs: "predict_outcomes",
    gradient: "var(--gradient-cognitive)",
  },
  {
    tab: "discover",
    label: "Discovery",
    blurb: "Search your datasets by sound, not by keyword.",
    icon: Compass,
    needs: "semantic_model",
    gradient: "var(--gradient-social)",
  },
  {
    tab: "tags",
    label: "Tracking & pixels",
    blurb: "Your site tag, and the results you measure against.",
    icon: Tag,
    needs: "pixels_tracking",
    gradient: "var(--gradient-contextual)",
  },
];

const Kpi = ({
  label,
  value,
  gradient,
}: {
  label: string;
  value: string;
  gradient: string;
}) => (
  <Card className="relative overflow-hidden border-border/60 bg-card/70 p-4 backdrop-blur-sm">
    <span aria-hidden className="absolute inset-x-0 top-0 h-1" style={{ background: gradient }} />
    <p className="text-xs text-muted-foreground">{label}</p>
    <p
      className="truncate bg-clip-text text-2xl font-semibold capitalize text-transparent sm:text-3xl"
      style={{ backgroundImage: gradient }}
    >
      {value}
    </p>
  </Card>
);

const AccountPortal = () => {
  const { account } = useParams();
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();
  const { orgs, capabilitiesFor, loading } = useOrganization();
  const [datasets, setDatasets] = useState(0);
  const [analyses, setAnalyses] = useState<AnalysisRow[]>([]);
  const [analysisCount, setAnalysisCount] = useState<number | null>(null);
  const [feeds, setFeeds] = useState<{ activation_id: string; label: string | null }[]>([]);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    if (!authLoading && !user) {
      navigate(`/auth?next=${encodeURIComponent(`/portal/${account ?? ""}`)}`, { replace: true });
    }
  }, [authLoading, user, navigate, account]);

  const org: OrgMembership | null = useMemo(
    () =>
      orgs.find((o) => o.slug === account) ??
      orgs.find((o) => o.organization_id === account) ??
      null,
    [orgs, account],
  );
  const capabilities = capabilitiesFor(org?.organization_id ?? null);

  const load = useCallback(async () => {
    if (!org) return;
    const id = org.organization_id;
    const [ds, ac, recent, granted] = await Promise.all([
      supabase
        .from("enterprise_datasets")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", id),
      supabase
        .from("source_analyses")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", id),
      supabase
        .from("source_analyses")
        .select("id, source_name, category, created_at, confidence")
        .eq("organization_id", id)
        .order("created_at", { ascending: false })
        .limit(6),
      supabase
        .from("org_intuizi_activations")
        .select("activation_id, label")
        .eq("organization_id", id)
        .eq("is_active", true)
        .order("activation_id"),
    ]);
    setDatasets(ds.count ?? 0);
    setAnalysisCount(ac.count ?? null);
    setAnalyses((recent.data ?? []) as AnalysisRow[]);
    setFeeds((granted.data ?? []) as { activation_id: string; label: string | null }[]);
  }, [org]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  const open = (tab: string) =>
    navigate(`/workspace?org=${org?.organization_id ?? ""}&tab=${tab}`);

  if (loading) {
    return (
      <div className="mx-auto max-w-5xl space-y-3 p-4">
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  if (!org) {
    return (
      <div className="mx-auto max-w-2xl p-6">
        <Card className="p-6 text-center">
          <Building2 className="mx-auto h-8 w-8 text-primary" />
          <h1 className="mt-3 text-lg font-semibold">That account isn't yours to open</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            You're not a member of this account. Ask its owner for an invite, or open one of your
            own accounts below.
          </p>
          <div className="mt-4 flex flex-wrap justify-center gap-2">
            {orgs.map((o) => (
              <Button key={o.organization_id} asChild variant="outline" size="sm">
                <Link to={`/portal/${o.slug || o.organization_id}`}>{o.name}</Link>
              </Button>
            ))}
            <Button asChild variant="ghost" size="sm">
              <Link to="/">Back to SonicSIM</Link>
            </Button>
          </div>
        </Card>
      </div>
    );
  }

  const shortcuts = SHORTCUTS.filter((s) => !s.needs || capabilities[s.needs]);
  const viewOnly = !["owner", "analyst"].includes(org.role);

  return (
    <div className="relative min-h-screen gradient-app">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-72 opacity-40 blur-3xl"
        style={{ background: "var(--gradient-brand)" }}
      />
      <header className="sticky top-0 z-30 border-b border-border/60 bg-background/80 shadow-elegant backdrop-blur-md">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3">
          <span
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg shadow-elegant"
            style={{ background: "var(--gradient-teal)" }}
          >
            <Radio className="h-4 w-4 text-primary-foreground" />
          </span>
          <h1
            className="min-w-0 break-words bg-clip-text text-base font-semibold text-transparent sm:truncate sm:text-lg"
            style={{ backgroundImage: "var(--gradient-teal)" }}
          >
            {org.name}
          </h1>
          {viewOnly && (
            <Badge variant="outline" className="shrink-0 text-[11px]">
              view only
            </Badge>
          )}
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <ThemeToggle className="h-8 w-8 text-muted-foreground hover:text-foreground" />
            <img
              src={sonicSimLogo}
              alt="SonicSIM.ai"
              className="hidden h-6 w-auto max-w-[28vw] object-contain opacity-80 sm:block md:h-7"
              loading="lazy"
              decoding="async"
            />
            <Button asChild variant="ghost" size="sm">
              <Link to="/">
                <ArrowLeft className="mr-1 h-4 w-4" />
                Home
              </Link>
            </Button>
            <Button variant="outline" size="sm" onClick={() => setRefreshKey((k) => k + 1)}>
              <RefreshCw className="mr-1 h-4 w-4" />
              Refresh
            </Button>
          </div>
        </div>
      </header>

      <main className="relative mx-auto max-w-5xl px-3 py-5 pb-mobile-nav sm:px-4 sm:py-6">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Kpi label="Plan" value={org.plan} gradient="var(--gradient-cognitive)" />
          <Kpi label="Your role" value={org.role} gradient="var(--gradient-contextual)" />
          <Kpi label="Datasets" value={String(datasets)} gradient="var(--gradient-social)" />
          <Kpi
            label="Saved analyses"
            value={analysisCount === null ? "—" : String(analysisCount)}
            gradient="var(--gradient-artistic)"
          />
        </div>

        <div className="mt-6">
          <PanelErrorBoundary label="What changed">
            <WorkspaceDigestCard
              key={`${refreshKey}-${org.organization_id}`}
              organizationId={org.organization_id}
              onPick={open}
            />
          </PanelErrorBoundary>
        </div>

        <h2 className="mt-6 text-sm font-semibold text-foreground">What you can do here</h2>
        <div className="mt-2 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {shortcuts.map((s) => (
            <button key={s.tab} type="button" onClick={() => open(s.tab)} className="text-left">
              <Card className="relative h-full overflow-hidden border-border/60 bg-card/70 p-4 backdrop-blur-sm transition-smooth hover:shadow-elegant">
                <span
                  aria-hidden
                  className="absolute inset-x-0 top-0 h-1"
                  style={{ background: s.gradient }}
                />
                <span className="mb-2 inline-flex rounded-lg bg-primary/10 p-2 text-primary">
                  <s.icon className="h-4 w-4" aria-hidden />
                </span>
                <p className="text-sm font-semibold text-foreground">{s.label}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">{s.blurb}</p>
                <span className="mt-2 inline-flex items-center text-xs text-primary">
                  Open <ArrowRight className="ml-1 h-3 w-3" aria-hidden />
                </span>
              </Card>
            </button>
          ))}
        </div>

        <div className="mt-6 grid gap-3 lg:grid-cols-2">
          <Card className="border-border/60 bg-card/70 p-4 backdrop-blur-sm">
            <h2 className="text-sm font-semibold text-foreground">Latest analyses</h2>
            {analyses.length === 0 ? (
              <p className="mt-2 text-sm text-muted-foreground">
                Nothing scored yet. Upload a track under Your data to start.
              </p>
            ) : (
              <ul className="mt-2 space-y-2">
                {analyses.map((a) => (
                  <li
                    key={a.id}
                    className="flex items-center justify-between gap-3 rounded-lg border border-border/60 bg-card/60 px-3 py-2"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-foreground">
                        {a.source_name}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {a.category ?? "uncategorised"} ·{" "}
                        {new Date(a.created_at).toLocaleDateString()}
                      </p>
                    </div>
                    {a.confidence != null && (
                      <Badge variant="outline" className="shrink-0 text-xs">
                        {Math.round(Number(a.confidence) * 100)}%
                      </Badge>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card className="border-border/60 bg-card/70 p-4 backdrop-blur-sm">
            <h2 className="text-sm font-semibold text-foreground">Your data feeds</h2>
            {feeds.length === 0 ? (
              <p className="mt-2 text-sm text-muted-foreground">
                No feed is connected to this account yet.
              </p>
            ) : (
              <ul className="mt-2 space-y-2">
                {feeds.map((f) => (
                  <li
                    key={f.activation_id}
                    className="flex items-center justify-between gap-3 rounded-lg border border-border/60 bg-card/60 px-3 py-2"
                  >
                    <span className="truncate text-sm text-foreground">
                      {f.label ?? `Feed ${f.activation_id}`}
                    </span>
                    <Badge variant="secondary" className="shrink-0 text-xs">
                      active
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
            {capabilities.enrichment_preview && feeds.length > 0 && (
              <Button variant="outline" size="sm" className="mt-3" onClick={() => open("enrich")}>
                See what SonicSIM adds
              </Button>
            )}
          </Card>
        </div>

        {orgs.length > 1 && (
          <div className="mt-6">
            <h2 className="text-sm font-semibold text-foreground">Your other accounts</h2>
            <div className="mt-2 flex flex-wrap gap-2">
              {orgs
                .filter((o) => o.organization_id !== org.organization_id)
                .map((o) => (
                  <Button key={o.organization_id} asChild variant="outline" size="sm">
                    <Link to={`/portal/${o.slug || o.organization_id}`}>{o.name}</Link>
                  </Button>
                ))}
            </div>
          </div>
        )}
      </main>
    </div>
  );
};

export default AccountPortal;
