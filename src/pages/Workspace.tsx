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
  const { orgs, active, activeId, setActiveId, canWrite, loading } = useOrganization();
  const [params, setParams] = useSearchParams();
  const tabPrefKey = user ? `sonicsim.workspace.tab.${user.id}` : null;
  const storedTab = tabPrefKey ? localStorage.getItem(tabPrefKey) : null;
  const validTab = (value: string | null) =>
    value && TABS.some((t) => t.key === value) ? value : null;
  const tab = validTab(params.get("tab")) ?? validTab(storedTab) ?? "analyses";
  const [datasets, setDatasets] = useState<{ id: string; name: string }[]>([]);
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

  useEffect(() => {
    void loadDatasets();
  }, [loadDatasets, refreshKey]);

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
    <div className="mx-auto max-w-6xl p-3 sm:p-6">
      <header className="flex flex-wrap items-center gap-3">
        <Button asChild variant="ghost" size="sm">
          <Link to="/">
            <ArrowLeft className="mr-1 h-4 w-4" />
            Home
          </Link>
        </Button>
        <img src={sonicSimLogo} alt="SonicSIM.ai" className="h-8 w-auto" />
        <div className="min-w-0">
          <h1 className="truncate text-lg font-semibold">{active.name} workspace</h1>
          <p className="text-[11px] text-muted-foreground">
            {active.plan} plan · your role: {active.role}
          </p>
        </div>
        {orgs.length > 1 && (
          <Select value={activeId ?? undefined} onValueChange={setActiveId}>
            <SelectTrigger className="ml-auto w-[200px]">
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
        {!canWrite && (
          <Badge variant="outline" className="text-[11px]">view only</Badge>
        )}
      </header>

      <Tabs value={tab} onValueChange={setTab} className="mt-4">
        <TabsList className="flex h-auto w-full flex-wrap justify-start gap-1">
          {TABS.map((t) => (
            <TabsTrigger key={t.key} value={t.key} className="text-xs">
              <t.icon className="mr-1 h-3.5 w-3.5" />
              {t.label}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="analyses" className="mt-4">
          <WorkspaceAnalyses key={refreshKey} organizationId={active.organization_id} />
        </TabsContent>
        <TabsContent value="data" className="mt-4">
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
    </div>
  );
};

export default Workspace;
