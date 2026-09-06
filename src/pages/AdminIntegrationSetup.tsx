// Per-connector configuration screen: /admin/integrations/:integrationId
// Real setup surface — readiness checklist, credential CRUD, connection test,
// sample request and full test history for a single provider.
import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { INTEGRATIONS } from "@/config/integrations";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  IntegrationCrudCard,
  type StatusEntry,
  type TestEntry,
} from "@/components/admin/IntegrationCrudCard";
import { IntegrationTestHistory } from "@/components/admin/IntegrationTestHistory";
import {
  ArrowLeft,
  Circle,
  CheckCircle2,
  ExternalLink,
  ListOrdered,
  Loader2,
  Network,
  Plug,
  RefreshCw,
} from "lucide-react";

const AdminIntegrationSetup = () => {
  const { integrationId } = useParams<{ integrationId: string }>();
  const navigate = useNavigate();
  const integration = INTEGRATIONS.find((i) => i.id === integrationId);

  const [status, setStatus] = useState<StatusEntry | undefined>();
  const [lastTest, setLastTest] = useState<TestEntry | undefined>();
  const [statusLoading, setStatusLoading] = useState(true);
  const [historyKey, setHistoryKey] = useState(0);

  const refresh = useCallback(async () => {
    if (!integrationId) return;
    setStatusLoading(true);
    const { data, error } = await supabase.functions.invoke("admin-get-credential-status");
    if (!error && data) {
      const all = (data.status ?? {}) as Record<string, StatusEntry>;
      const tests = (data.lastTest ?? {}) as Record<string, TestEntry>;
      setStatus(all[integrationId]);
      setLastTest(tests[integrationId]);
    }
    setStatusLoading(false);
    setHistoryKey((k) => k + 1);
  }, [integrationId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (!integration) {
    return (
      <div className="container mx-auto max-w-2xl px-6 py-16 text-center space-y-4">
        <h1 className="text-xl font-semibold">Unknown integration</h1>
        <p className="text-sm text-muted-foreground">
          There is no connector registered with the id “{integrationId}”.
        </p>
        <Button variant="outline" onClick={() => navigate("/admin/integrations")}>
          <ArrowLeft className="mr-1 h-4 w-4" /> Back to integrations
        </Button>
      </div>
    );
  }

  const saved = new Set(status?.fields ?? []);
  const required = integration.fields.filter((f) => f.required);
  const missing = required.filter((f) => !saved.has(f.key));

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-10 border-b border-border bg-card/40 backdrop-blur">
        <div className="container mx-auto flex items-center justify-between gap-3 px-6 py-4">
          <div className="flex min-w-0 items-center gap-3">
            <Button variant="ghost" size="sm" asChild>
              <Link to="/admin/integrations">
                <ArrowLeft className="mr-1 h-4 w-4" /> All connectors
              </Link>
            </Button>
            <div className="flex min-w-0 items-center gap-2">
              {integration.kind === "mcp" ? (
                <Network className="h-5 w-5 text-primary" />
              ) : (
                <Plug className="h-5 w-5 text-primary" />
              )}
              <h1 className="truncate text-base font-semibold sm:text-xl">
                {integration.name}
              </h1>
            </div>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void refresh()}
            disabled={statusLoading}
            aria-label="Refresh connection status"
          >
            <RefreshCw className={`h-4 w-4 ${statusLoading ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </header>

      <main className="container mx-auto max-w-3xl space-y-6 px-6 py-8">
        <Card className="p-5 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className="text-[11px] uppercase">
              {integration.kind === "mcp" ? "MCP server" : "REST API"}
            </Badge>
            {statusLoading ? (
              <Badge variant="outline" className="gap-1">
                <Loader2 className="h-3 w-3 animate-spin" /> Checking…
              </Badge>
            ) : missing.length === 0 ? (
              <Badge className="gap-1 bg-green-600 hover:bg-green-600">
                <CheckCircle2 className="h-3 w-3" /> Ready
              </Badge>
            ) : (
              <Badge variant="outline" className="border-amber-600/50 text-amber-600">
                {missing.length} required field{missing.length > 1 ? "s" : ""} missing
              </Badge>
            )}
            <a
              href={integration.docsUrl}
              target="_blank"
              rel="noreferrer"
              className="ml-auto flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            >
              Provider docs <ExternalLink className="h-3 w-3" />
            </a>
          </div>
          <p className="text-sm text-muted-foreground">{integration.description}</p>

          {required.length > 0 && (
            <ul className="space-y-1 pt-1 text-sm">
              {required.map((f) => {
                const ok = saved.has(f.key);
                return (
                  <li key={f.key} className="flex items-center gap-2">
                    {ok ? (
                      <CheckCircle2 className="h-4 w-4 text-green-600" />
                    ) : (
                      <Circle className="h-4 w-4 text-muted-foreground" />
                    )}
                    <span className={ok ? "" : "text-muted-foreground"}>{f.label}</span>
                    {ok && (
                      <span className="text-xs text-muted-foreground">•••• stored</span>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        <Card className="p-5 space-y-2">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <ListOrdered className="h-4 w-4 text-primary" /> Setup steps
          </h2>
          <ol className="list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
            {integration.setupSteps.map((step, i) => (
              <li key={i}>{step}</li>
            ))}
          </ol>
        </Card>

        <IntegrationCrudCard
          integration={integration}
          status={status}
          lastTest={lastTest}
          statusLoading={statusLoading}
          onChanged={() => void refresh()}
        />

        <IntegrationTestHistory integrationId={integration.id} refreshKey={historyKey} />
      </main>
    </div>
  );
};

export default AdminIntegrationSetup;
