import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Network, Plug, RefreshCw, Settings2, Zap } from "lucide-react";
import { INTEGRATIONS, type IntegrationKind } from "@/config/integrations";
import {
  ConnectedIntegrationsPanel,
  verifiedIntegrations,
  type StatusEntry,
  type TestEntry,
} from "@/components/admin/ConnectedIntegrationsPanel";
import { IntegrationCrudCard } from "@/components/admin/IntegrationCrudCard";

type View = "connected" | "rest" | "mcp";

/**
 * "APIs & MCPs" tab for the admin dashboard: verified console plus full CRUD
 * (create/update/delete connection settings), connection tests, and sample
 * request validation for every registered REST API and MCP server.
 */
export const AdminConnectedApisTab = () => {
  const navigate = useNavigate();
  const [status, setStatus] = useState<Record<string, StatusEntry>>({});
  const [lastTest, setLastTest] = useState<Record<string, TestEntry>>({});
  const [statusLoading, setStatusLoading] = useState(true);
  const [view, setView] = useState<View>("connected");

  const refresh = useCallback(async () => {
    setStatusLoading(true);
    const { data, error } = await supabase.functions.invoke("admin-get-credential-status");
    if (!error && data) {
      setStatus((data.status ?? {}) as Record<string, StatusEntry>);
      setLastTest((data.lastTest ?? {}) as Record<string, TestEntry>);
    }
    setStatusLoading(false);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const connectedCount = useMemo(
    () => verifiedIntegrations(status, lastTest).length,
    [status, lastTest],
  );

  const listFor = (kind: IntegrationKind) => INTEGRATIONS.filter((i) => i.kind === kind);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="outline" onClick={() => void refresh()} disabled={statusLoading}>
          <RefreshCw className={`mr-1 h-4 w-4 ${statusLoading ? "animate-spin" : ""}`} />
          Refresh
        </Button>
        <Button size="sm" variant="outline" onClick={() => navigate("/admin/integrations")}>
          <Settings2 className="mr-1 h-4 w-4" />
          Full setup page
        </Button>
      </div>

      <Tabs value={view} onValueChange={(v) => setView(v as View)}>
        <TabsList className="grid w-full max-w-xl grid-cols-3">
          <TabsTrigger value="connected" className="gap-1 text-xs sm:text-sm">
            <Zap className="h-3.5 w-3.5" /> Connected ({connectedCount})
          </TabsTrigger>
          <TabsTrigger value="rest" className="gap-1 text-xs sm:text-sm">
            <Plug className="h-3.5 w-3.5" /> REST ({listFor("rest").length})
          </TabsTrigger>
          <TabsTrigger value="mcp" className="gap-1 text-xs sm:text-sm">
            <Network className="h-3.5 w-3.5" /> MCP ({listFor("mcp").length})
          </TabsTrigger>
        </TabsList>
      </Tabs>

      {view === "connected" ? (
        <ConnectedIntegrationsPanel
          status={status}
          lastTest={lastTest}
          statusLoading={statusLoading}
          onRefresh={() => void refresh()}
          onOpenSetup={() => setView("rest")}
        />
      ) : (
        <div className="space-y-4">
          {listFor(view).map((integration) => (
            <IntegrationCrudCard
              key={integration.id}
              integration={integration}
              status={status[integration.id]}
              lastTest={lastTest[integration.id]}
              statusLoading={statusLoading}
              onChanged={() => void refresh()}
            />
          ))}
          {listFor(view).length === 0 && (
            <Card className="p-8 text-center text-sm text-muted-foreground">
              No {view === "mcp" ? "MCP servers" : "REST APIs"} in the registry yet.
            </Card>
          )}
        </div>
      )}
    </div>
  );
};

export default AdminConnectedApisTab;
