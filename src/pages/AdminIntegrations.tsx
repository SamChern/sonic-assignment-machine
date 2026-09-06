import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { INTEGRATIONS, type IntegrationKind } from "@/config/integrations";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  ConnectedIntegrationsPanel,
  verifiedIntegrations,
} from "@/components/admin/ConnectedIntegrationsPanel";
import {
  ArrowLeft,
  Loader2,
  ShieldCheck,
  Plug,
  Network,
  Zap,
  Settings2,
  RefreshCw,
  Activity,
} from "lucide-react";
import { LibrosaAudioTester } from "@/components/admin/LibrosaAudioTester";
import IntuiziConsoleView from "@/components/admin/intuizi/IntuiziConsoleView";
import {
  IntegrationCard,
  type StatusEntry,
  type TestEntry,
} from "@/components/admin/IntegrationCard";




const AdminIntegrations = () => {
  const { user, isAdmin, loading } = useAuth();
  const navigate = useNavigate();

  const [statusByIntegration, setStatusByIntegration] = useState<
    Record<string, StatusEntry>
  >({});
  const [lastTestByIntegration, setLastTestByIntegration] = useState<
    Record<string, TestEntry>
  >({});
  const [statusLoading, setStatusLoading] = useState(true);
  const [kindFilter, setKindFilter] = useState<IntegrationKind>("rest");
  const [searchParams, setSearchParams] = useSearchParams();
  const viewParam = searchParams.get("view");
  const view: "connected" | "setup" | "console" =
    viewParam === "connected" ? "connected" : viewParam === "console" ? "console" : "setup";
  const setView = (v: "connected" | "setup" | "console") => {
    const next = new URLSearchParams(searchParams);
    if (v === "setup") next.delete("view");
    else next.set("view", v);
    setSearchParams(next, { replace: true });
  };


  useEffect(() => {
    if (!loading) {
      if (!user) navigate("/auth");
      else if (!isAdmin) navigate("/");
    }
  }, [loading, user, isAdmin, navigate]);

  const refreshStatus = async () => {
    setStatusLoading(true);
    const { data, error } = await supabase.functions.invoke(
      "admin-get-credential-status",
    );
    if (!error && data) {
      setStatusByIntegration(data.status ?? {});
      setLastTestByIntegration(data.lastTest ?? {});
    }
    setStatusLoading(false);
  };

  useEffect(() => {
    if (isAdmin) refreshStatus();
  }, [isAdmin]);

  const connectedIds = useMemo(
    () => new Set(verifiedIntegrations(statusByIntegration, lastTestByIntegration).map((i) => i.id)),
    [statusByIntegration, lastTestByIntegration],
  );
  const connectedCount = connectedIds.size;
  const setupCount = INTEGRATIONS.length - connectedCount;

  if (loading || !isAdmin) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card/40 backdrop-blur sticky top-0 z-10">
        <div className="container mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => navigate("/admin")}
            >
              <ArrowLeft className="h-4 w-4 mr-1" /> Back
            </Button>
            <div className="flex items-center gap-2">
              <Plug className="h-5 w-5 text-primary" />
              <h1 className="text-base sm:text-xl font-semibold truncate">APIs &amp; MCPs</h1>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={refreshStatus} disabled={statusLoading} aria-label="Refresh connection status">
              <RefreshCw className={`h-4 w-4 ${statusLoading ? "animate-spin" : ""}`} />
            </Button>
            <Badge variant="outline" className="gap-1">
              <ShieldCheck className="h-3 w-3" /> Admin only
            </Badge>
          </div>
        </div>
      </header>

      <main
        className={`container mx-auto px-6 py-8 space-y-6 ${
          view === "console" ? "max-w-5xl" : "max-w-3xl"
        }`}
      >
        <Tabs value={view} onValueChange={(v) => setView(v as "connected" | "setup" | "console")}>
          <TabsList className="grid w-full max-w-2xl grid-cols-3">
            <TabsTrigger value="connected" className="gap-1">
              <Zap className="h-3.5 w-3.5" /> Connected ({connectedCount})
            </TabsTrigger>
            <TabsTrigger value="setup" className="gap-1">
              <Settings2 className="h-3.5 w-3.5" /> Needs setup ({setupCount})
            </TabsTrigger>
            <TabsTrigger value="console" className="gap-1">
              <Activity className="h-3.5 w-3.5" /> Intuizi Console
            </TabsTrigger>
          </TabsList>
        </Tabs>

        {view === "console" ? (
          <IntuiziConsoleView />
        ) : view === "connected" ? (
          <ConnectedIntegrationsPanel
            status={statusByIntegration}
            lastTest={lastTestByIntegration}
            statusLoading={statusLoading}
            onRefresh={refreshStatus}
            onOpenSetup={() => setView("setup")}
          />
        ) : (
        <div className="space-y-6">

        <p className="text-sm text-muted-foreground">
          Every connector has its own setup page. Credentials are stored
          server-side and only readable by edge functions — open a connector to
          paste keys, run <span className="font-medium">Test connection</span>,
          and review its test history.
        </p>

        <Tabs
          value={kindFilter}
          onValueChange={(v) => setKindFilter(v as IntegrationKind)}
        >
          <TabsList className="grid w-full max-w-sm grid-cols-2">
            <TabsTrigger value="rest" className="gap-1">
              <Plug className="h-3.5 w-3.5" /> REST APIs
            </TabsTrigger>
            <TabsTrigger value="mcp" className="gap-1">
              <Network className="h-3.5 w-3.5" /> MCP Servers
            </TabsTrigger>
          </TabsList>
        </Tabs>

        <IntegrationSetupList
          integrations={INTEGRATIONS.filter((i) => i.kind === kindFilter)}
          status={statusByIntegration}
          lastTest={lastTestByIntegration}
          statusLoading={statusLoading}
        />

        {INTEGRATIONS.filter((i) => i.kind === kindFilter).length === 0 && (
          <Card className="p-8 text-center text-sm text-muted-foreground">
            No {kindFilter === "mcp" ? "MCP servers" : "REST APIs"} configured
            in the registry yet.
          </Card>
        )}

        {kindFilter === "mcp" && <LibrosaAudioTester />}
        </div>

        )}
      </main>
    </div>
  );
};


export default AdminIntegrations;
