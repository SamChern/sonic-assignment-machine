import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useOrganization } from "@/hooks/useOrganization";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import WorkspaceAnalyses from "@/components/enterprise/WorkspaceAnalyses";
import WorkspaceUpload from "@/components/enterprise/WorkspaceUpload";
import IntuiziSyncPanel from "@/components/enterprise/IntuiziSyncPanel";
import DatasetDiscovery from "@/components/enterprise/DatasetDiscovery";
import PredictUsersPanel from "@/components/enterprise/PredictUsersPanel";
import PredictOutcomesPanel from "@/components/enterprise/PredictOutcomesPanel";
import PixelSetupPanel from "@/components/enterprise/PixelSetupPanel";
import CategoryProfileEditor from "@/components/enterprise/CategoryProfileEditor";
import sonicSimLogo from "@/assets/SonicSIM_transp.png";
import {
  ArrowLeft,
  Building2,
  Compass,
  LineChart,
  Radio,
  RefreshCw,
  Sliders,
  Sparkles,
  Tag,
  Target,
  Upload,
} from "lucide-react";


const TABS = [
  { key: "analyses", label: "Analyses", icon: Sparkles },
  { key: "data", label: "My data", icon: Upload },
  { key: "discover", label: "Discovery", icon: Compass },
  { key: "categories", label: "Categories", icon: Sliders },
  { key: "users", label: "Predict users", icon: Target },
  { key: "outcomes", label: "Predict outcomes", icon: LineChart },
  { key: "tags", label: "Tracking & pixels", icon: Tag },
] as const;

const Workspace = () => {
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const { orgs, active, activeId, setActiveId, canWrite, isOrgAdmin, loading } = useOrganization();
  const [params, setParams] = useSearchParams();
  const tabPrefKey = user ? `sonicsim.workspace.tab.${user.id}` : null;
  const storedTab = tabPrefKey ? localStorage.getItem(tabPrefKey) : null;
  const validTab = (value: string | null) =>
    value && TABS.some((t) => t.key === value) ? value : null;
  const tab = validTab(params.get("tab")) ?? validTab(storedTab) ?? "analyses";
  const [datasets, setDatasets] = useState<{ id: string; name: string }[]>([]);
  const [analysisCount, setAnalysisCount] = useState<number | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    if (!authLoading && !user) {
      // Preserve the workspace destination through sign-in.
      navigate("/auth?next=%2Fworkspace", { replace: true });
    }
  }, [authLoading, user, navigate]);

  const loadDatasets = useCallback(async () => {
    if (!activeId) return;
    const { data } = await supabase
      .from("enterprise_datasets")
      .select("id, name")
      .eq("organization_id", activeId)
      .order("created_at", { ascending: false });
    setDatasets((data ?? []) as { id: string; name: string }[]);
  }, [activeId]);

  const loadAnalysisCount = useCallback(async () => {
    if (!activeId) return;
    const { count } = await supabase
      .from("source_analyses")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", activeId);
    setAnalysisCount(count ?? 0);
  }, [activeId]);

  useEffect(() => {
    void loadDatasets();
    void loadAnalysisCount();
  }, [loadDatasets, loadAnalysisCount, refreshKey]);


  const setTab = (next: string) => {
    if (tabPrefKey) {
      try {
        localStorage.setItem(tabPrefKey, next);
      } catch {
        /* storage unavailable */
      }
    }
    const p = new URLSearchParams(params);
    p.set("tab", next);
    setParams(p, { replace: true });
  };

  if (loading) {
    return (
      <div className="mx-auto max-w-6xl space-y-3 p-4">
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  if (!active) {
    return (
      <div className="mx-auto max-w-2xl p-6">
        <Card className="p-6 text-center">
          <Building2 className="mx-auto h-8 w-8 text-primary" />
          <h1 className="mt-3 text-lg font-semibold">No enterprise workspace yet</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Your account is not a member of an enterprise organization. Ask your workspace owner for
            an invite, or contact us to license the enterprise version of SonicSIM.
          </p>
          <div className="mt-4 flex flex-wrap justify-center gap-2">
            <Button asChild>
              <a href="mailto:hello@example.com?subject=SonicSIM%20Enterprise%20%E2%80%94%20Learn%20More">
                Learn about Enterprise
              </a>
            </Button>
            <Button asChild variant="outline">
              <Link to="/">Back to SonicSIM</Link>
            </Button>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="relative min-h-screen gradient-app">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-72 opacity-40 blur-3xl"
        style={{ background: "var(--gradient-brand)" }}
      />
      <header className="sticky top-0 z-30 border-b border-border/60 bg-background/80 shadow-elegant backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3">
          <div className="flex min-w-0 items-center gap-2">
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
              {active.name} workspace
            </h1>
            {!canWrite && (
              <Badge variant="outline" className="shrink-0 text-[11px]">
                view only
              </Badge>
            )}
          </div>

          <div className="ml-auto flex flex-wrap items-center gap-2">
            <img
              src={sonicSimLogo}
              alt="SonicSIM.ai"
              className="hidden h-6 w-auto max-w-[28vw] object-contain opacity-80 sm:block md:h-7"
              loading="lazy"
              decoding="async"
            />
            {orgs.length > 1 && (
              <Select value={activeId ?? undefined} onValueChange={setActiveId}>
                <SelectTrigger className="h-9 w-full sm:w-[190px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {orgs.map((o) => (
                    <SelectItem key={o.organization_id} value={o.organization_id}>
                      {o.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <Button asChild variant="ghost" size="sm">
              <Link to="/">
                <ArrowLeft className="mr-1 h-4 w-4" />
                Home
              </Link>
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setRefreshKey((k) => k + 1);
                void loadDatasets();
              }}
            >
              <RefreshCw className="mr-1 h-4 w-4" />
              Refresh
            </Button>
          </div>
        </div>
      </header>

      <main className="relative mx-auto max-w-6xl px-3 py-5 pb-mobile-nav sm:px-4 sm:py-6">
        <div className="grid gap-3 grid-cols-2 sm:grid-cols-4">
          {([
            ["Plan", active.plan, "var(--gradient-cognitive)"],
            ["Your role", active.role, "var(--gradient-contextual)"],
            ["Datasets", String(datasets.length), "var(--gradient-social)"],
            ["Saved analyses", analysisCount === null ? "—" : String(analysisCount), "var(--gradient-artistic)"],
          ] as const).map(([label, value, gradient]) => (
            <Card
              key={label}
              className="relative overflow-hidden border-border/60 bg-card/70 p-4 backdrop-blur-sm transition-smooth hover:shadow-elegant"
            >
              <span
                aria-hidden
                className="absolute inset-x-0 top-0 h-1"
                style={{ background: gradient }}
              />
              <p className="text-xs text-muted-foreground">{label}</p>
              <p
                className="truncate bg-clip-text text-2xl font-semibold capitalize text-transparent sm:text-3xl"
                style={{ backgroundImage: gradient }}
              >
                {value}
              </p>
            </Card>
          ))}
        </div>

        <Tabs value={tab} onValueChange={setTab} className="mt-6">
          <TabsList className="grid h-auto w-full grid-cols-2 gap-1 border border-border/60 bg-card/70 p-1 backdrop-blur-sm sm:flex sm:flex-wrap sm:justify-start">
            {TABS.map((t) => (
              <TabsTrigger
                key={t.key}
                value={t.key}
                className="min-w-0 justify-start whitespace-normal px-2 text-center text-[11px] leading-tight sm:justify-center sm:whitespace-nowrap sm:text-xs"
              >
                <t.icon className="mr-1 h-3.5 w-3.5 shrink-0" />
                <span className="min-w-0">{t.label}</span>
              </TabsTrigger>
            ))}
          </TabsList>


        <TabsContent value="analyses" className="mt-4">
          <WorkspaceAnalyses key={refreshKey} organizationId={active.organization_id} />
        </TabsContent>
        <TabsContent value="data" className="mt-4 space-y-4">
          <IntuiziSyncPanel
            organizationId={active.organization_id}
            canWrite={canWrite}
            onSynced={() => {
              setRefreshKey((k) => k + 1);
              void loadDatasets();
            }}
          />
          <WorkspaceUpload
            organizationId={active.organization_id}
            canWrite={canWrite}
            onIngested={() => setRefreshKey((k) => k + 1)}
          />
        </TabsContent>
        <TabsContent value="discover" className="mt-4">
          <DatasetDiscovery key={refreshKey} organizationId={active.organization_id} />
        </TabsContent>
        <TabsContent value="categories" className="mt-4">
          <CategoryProfileEditor
            organizationId={active.organization_id}
            canEdit={isOrgAdmin}
            onSaved={() => setRefreshKey((k) => k + 1)}
          />

        </TabsContent>
        <TabsContent value="users" className="mt-4">
          <PredictUsersPanel
            key={refreshKey}
            organizationId={active.organization_id}
            canWrite={canWrite}
          />
        </TabsContent>

        <TabsContent value="outcomes" className="mt-4">
          <PredictOutcomesPanel
            organizationId={active.organization_id}
            canWrite={canWrite}
            datasets={datasets}
          />
        </TabsContent>
        <TabsContent value="tags" className="mt-4">
          <PixelSetupPanel organizationId={active.organization_id} canWrite={canWrite} />
        </TabsContent>
        </Tabs>
      </main>
    </div>
  );

};

export default Workspace;
