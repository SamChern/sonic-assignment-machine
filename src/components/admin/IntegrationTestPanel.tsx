import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { INTEGRATIONS, type Integration } from "@/config/integrations";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";

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
  const [testingIds, setTestingIds] = useState<string[]>([]);
  const [runningAll, setRunningAll] = useState(false);
  const [summary, setSummary] = useState<{ passed: number; failed: number; skipped: number } | null>(
    null,
  );
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
    setTestingIds((ids) => [...ids, integration.id]);
    const toastId = toast.loading(`Testing ${integration.name}…`);
    try {
      await runIntegrationTest(integration);
    } finally {
      toast.dismiss(toastId);
      setTestingIds((ids) => ids.filter((id) => id !== integration.id));
    }
    await refresh();
  };

  const testAll = async () => {
    const testable = INTEGRATIONS.filter((i) => i.testEndpoint);
    const skipped = INTEGRATIONS.length - testable.length;
    setRunningAll(true);
    setSummary(null);
    setTestingIds(testable.map((i) => i.id));
    const toastId = toast.loading(`Testing ${testable.length} integrations…`);
    let passed = 0;
    let failed = 0;
    try {
      const results = await Promise.all(
        testable.map(async (i) => {
          const ok = await runIntegrationTest(i);
          setTestingIds((ids) => ids.filter((id) => id !== i.id));
          return ok;
        }),
      );
      passed = results.filter(Boolean).length;
      failed = results.length - passed;
    } finally {
      toast.dismiss(toastId);
      setTestingIds([]);
      setRunningAll(false);
    }
    setSummary({ passed, failed, skipped });
    if (failed === 0) {
      toast.success(`All ${passed} tested integrations passed.`);
    } else {
      toast.error(`${failed} of ${passed + failed} integrations failed.`);
    }
    await refresh();
  };

  return (
    <Card className="mb-8 overflow-hidden bg-card/80">
      <div className="flex items-center justify-between gap-2 border-b border-border/60 px-4 py-3">
        <div className="flex items-center gap-2">
          <Plug className="h-4 w-4 text-primary" />
          <h2 className="text-sm font-semibold">APIs &amp; MCPs — connection tests</h2>
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="outline"
            size="sm"
            className="h-8 text-xs"
            onClick={testAll}
            disabled={runningAll || loading}
          >
            {runningAll ? (
              <Loader2 className="mr-1 h-4 w-4 animate-spin" />
            ) : (
              <Zap className="mr-1 h-4 w-4" />
            )}
            Test all
          </Button>
          <Button variant="ghost" size="sm" onClick={refresh} disabled={loading || runningAll}>
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </div>

      {(runningAll || summary) && (
        <div className="flex flex-wrap items-center gap-2 border-b border-border/60 bg-muted/30 px-4 py-2 text-xs">
          {runningAll ? (
            <span className="flex items-center gap-2 text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" />
              Running {testingIds.length} test{testingIds.length !== 1 ? "s" : ""}…
            </span>
          ) : (
            summary && (
              <>
                <Badge className="gap-1 bg-green-600 hover:bg-green-600">
                  <CheckCircle2 className="h-3 w-3" /> {summary.passed} passed
                </Badge>
                {summary.failed > 0 && (
                  <Badge variant="destructive" className="gap-1">
                    <XCircle className="h-3 w-3" /> {summary.failed} failed
                  </Badge>
                )}
                {summary.skipped > 0 && (
                  <Badge variant="secondary">{summary.skipped} without tester</Badge>
                )}
              </>
            )
          )}
        </div>
      )}


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
                  disabled={testingIds.includes(i.id) || runningAll || !i.testEndpoint}
                  title={i.testEndpoint ? "Test connection" : "No automated tester"}
                >
                  {testingIds.includes(i.id) ? (

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
