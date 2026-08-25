import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { INTEGRATIONS, type Integration } from "@/config/integrations";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  IntegrationDetailsDrawer,
  runIntegrationTest,
  type DrawerStatusEntry,
  type DrawerTestEntry,
} from "@/components/admin/IntegrationDetailsDrawer";
import {
  CheckCircle2,
  XCircle,
  Loader2,
  Zap,
  Plug,
  RefreshCw,
  Info,
  AlertTriangle,
} from "lucide-react";

/**
 * Compact API/MCP tester for the admin dashboard: test any provider and open a
 * details drawer without navigating away.
 */
export function IntegrationTestPanel() {
  const [status, setStatus] = useState<Record<string, DrawerStatusEntry>>({});
  const [lastTest, setLastTest] = useState<Record<string, DrawerTestEntry>>({});
  const [loading, setLoading] = useState(true);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [drawerFor, setDrawerFor] = useState<Integration | null>(null);

  const refresh = async () => {
    setLoading(true);
    const { data, error } = await supabase.functions.invoke("admin-get-credential-status");
    if (!error && data) {
      setStatus((data as { status?: Record<string, DrawerStatusEntry> }).status ?? {});
      setLastTest((data as { lastTest?: Record<string, DrawerTestEntry> }).lastTest ?? {});
    }
    setLoading(false);
  };

  useEffect(() => {
    refresh();
  }, []);

  const test = async (integration: Integration) => {
    setTestingId(integration.id);
    await runIntegrationTest(integration);
    setTestingId(null);
    refresh();
  };

  return (
    <Card className="mb-8 overflow-hidden bg-card/80">
      <div className="flex items-center justify-between gap-2 border-b border-border/60 px-4 py-3">
        <div className="flex items-center gap-2">
          <Plug className="h-4 w-4 text-primary" />
          <h2 className="text-sm font-semibold">APIs &amp; MCPs — connection tests</h2>
        </div>
        <Button variant="ghost" size="sm" onClick={refresh} disabled={loading}>
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
        </Button>
      </div>

      <div className="divide-y divide-border/60">
        {INTEGRATIONS.map((i) => {
          const saved = new Set(status[i.id]?.fields ?? []);
          const missing = i.fields.filter((f) => f.required && !saved.has(f.key)).length;
          const t = lastTest[i.id];
          return (
            <div
              key={i.id}
              className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 transition-colors hover:bg-muted/40"
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="truncate text-sm font-medium">{i.name}</span>
                  <Badge variant="outline" className="text-[10px] uppercase">
                    {i.kind === "mcp" ? "MCP" : "REST"}
                  </Badge>
                  {t ? (
                    t.success ? (
                      <Badge className="gap-1 bg-green-600 text-[11px] hover:bg-green-600">
                        <CheckCircle2 className="h-3 w-3" /> Verified
                      </Badge>
                    ) : (
                      <Badge variant="destructive" className="gap-1 text-[11px]">
                        <XCircle className="h-3 w-3" /> Last test failed
                      </Badge>
                    )
                  ) : (
                    <Badge variant="secondary" className="text-[11px]">
                      Untested
                    </Badge>
                  )}
                  {missing > 0 && (
                    <Badge variant="outline" className="gap-1 text-[11px] text-destructive">
                      <AlertTriangle className="h-3 w-3" /> {missing} input
                      {missing !== 1 ? "s" : ""} needed
                    </Badge>
                  )}
                </div>
                {t && !t.success && t.error_message && (
                  <p className="mt-1 line-clamp-1 text-xs text-destructive">{t.error_message}</p>
                )}
              </div>

              <div className="flex items-center gap-1">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 text-xs"
                  onClick={() => test(i)}
                  disabled={testingId === i.id || !i.testEndpoint}
                  title={i.testEndpoint ? "Test connection" : "No automated tester"}
                >
                  {testingId === i.id ? (
                    <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                  ) : (
                    <Zap className="h-4 w-4 mr-1" />
                  )}
                  Test
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 text-xs"
                  onClick={() => setDrawerFor(i)}
                >
                  <Info className="h-4 w-4 mr-1" /> Details
                </Button>
              </div>
            </div>
          );
        })}
      </div>

      <IntegrationDetailsDrawer
        integration={drawerFor}
        status={drawerFor ? status[drawerFor.id] : undefined}
        lastTest={drawerFor ? lastTest[drawerFor.id] : undefined}
        open={!!drawerFor}
        onOpenChange={(o) => !o && setDrawerFor(null)}
        onTested={refresh}
      />
    </Card>
  );
}

export default IntegrationTestPanel;
