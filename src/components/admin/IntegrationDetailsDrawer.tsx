import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { Integration } from "@/config/integrations";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { replaceLegacyBrandText } from "@/lib/brandText";
import {
  CheckCircle2,
  XCircle,
  Loader2,
  Zap,
  ExternalLink,
  AlertTriangle,
  ListOrdered,
  KeyRound,
} from "lucide-react";

export interface DrawerStatusEntry {
  fields: string[];
  updated_at: string | null;
}
export interface DrawerTestEntry {
  integration_id: string;
  success: boolean;
  latency_ms: number | null;
  error_message: string | null;
  tested_at: string;
}

/**
 * Run the provider's tester edge function. Shared by the drawer and any
 * inline "Test connection" button so behaviour stays identical everywhere.
 */
export async function runIntegrationTest(integration: Integration) {
  if (!integration.testEndpoint) {
    toast.info(`No automated tester available for ${integration.name}.`);
    return false;
  }
  const { data, error } = await supabase.functions.invoke(integration.testEndpoint, {
    body: { integration_id: integration.id },
  });
  if (error) {
    toast.error(`${integration.name}: ${replaceLegacyBrandText(error.message)}`);
    return false;
  }
  if ((data as { success?: boolean })?.success) {
    const ms = (data as { latency_ms?: number }).latency_ms;
    toast.success(`${integration.name} connection OK${ms ? ` (${ms}ms)` : ""}`);
    return true;
  }
  toast.error(
    `${integration.name}: ${replaceLegacyBrandText((data as { error?: string })?.error) ?? "Test failed"}`,
  );
  return false;
}

/** Side drawer: required inputs, setup steps, and the last test outcome. */
export function IntegrationDetailsDrawer({
  integration,
  status,
  lastTest,
  open,
  onOpenChange,
  onTested,
}: {
  integration: Integration | null;
  status?: DrawerStatusEntry;
  lastTest?: DrawerTestEntry;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onTested?: () => void;
}) {
  const [testing, setTesting] = useState(false);

  if (!integration) return null;

  const saved = new Set(status?.fields ?? []);
  const missingRequired = integration.fields.filter((f) => f.required && !saved.has(f.key));

  const handleTest = async () => {
    setTesting(true);
    await runIntegrationTest(integration);
    setTesting(false);
    onTested?.();
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-lg overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            {integration.name}
            <Badge variant="outline" className="text-[11px] uppercase">
              {integration.kind === "mcp" ? "MCP" : "REST"}
            </Badge>
          </SheetTitle>
          <SheetDescription>{integration.description}</SheetDescription>
        </SheetHeader>

        <div className="mt-6 space-y-6">
          {/* Last test */}
          <section className="space-y-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Last connection test
            </h3>
            {!lastTest ? (
              <p className="text-sm text-muted-foreground">Never tested.</p>
            ) : lastTest.success ? (
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <Badge className="gap-1 bg-green-600 hover:bg-green-600">
                  <CheckCircle2 className="h-3 w-3" /> Passed
                </Badge>
                <span className="text-muted-foreground">
                  {new Date(lastTest.tested_at).toLocaleString()}
                  {lastTest.latency_ms ? ` • ${lastTest.latency_ms}ms` : ""}
                </span>
              </div>
            ) : (
              <div className="space-y-2">
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <Badge variant="destructive" className="gap-1">
                    <XCircle className="h-3 w-3" /> Failed
                  </Badge>
                  <span className="text-muted-foreground">
                    {new Date(lastTest.tested_at).toLocaleString()}
                  </span>
                </div>
                {lastTest.error_message && (
                  <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-md border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive">
                    {replaceLegacyBrandText(lastTest.error_message)}
                  </pre>
                )}
              </div>
            )}
            <Button size="sm" onClick={handleTest} disabled={testing || !integration.testEndpoint}>
              {testing ? (
                <Loader2 className="h-4 w-4 mr-1 animate-spin" />
              ) : (
                <Zap className="h-4 w-4 mr-1" />
              )}
              {integration.testEndpoint ? "Test connection" : "Test unavailable"}
            </Button>
          </section>

          {/* Required inputs */}
          <section className="space-y-2">
            <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              <KeyRound className="h-3.5 w-3.5" /> Required user inputs
            </h3>
            {integration.fields.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No credentials of its own — it reuses another provider's connection.
              </p>
            ) : (
              <ul className="divide-y divide-border/60 rounded-md border border-border/60">
                {integration.fields.map((f) => {
                  const isSaved = saved.has(f.key);
                  return (
                    <li key={f.key} className="space-y-1 p-3">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-medium">
                          {f.label}
                          {f.required && <span className="ml-1 text-destructive">*</span>}
                        </span>
                        {isSaved ? (
                          <Badge variant="secondary" className="gap-1 text-[11px]">
                            <CheckCircle2 className="h-3 w-3" /> Saved
                          </Badge>
                        ) : (
                          <Badge
                            variant={f.required ? "destructive" : "outline"}
                            className="gap-1 text-[11px]"
                          >
                            <AlertTriangle className="h-3 w-3" />
                            {f.required ? "Missing" : "Optional"}
                          </Badge>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground">{f.helpText}</p>
                    </li>
                  );
                })}
              </ul>
            )}
            {missingRequired.length > 0 && (
              <p className="text-xs text-destructive">
                {missingRequired.length} required field
                {missingRequired.length !== 1 ? "s" : ""} still needed before this can pass a test.
              </p>
            )}
            {status?.updated_at && (
              <p className="text-xs text-muted-foreground">
                Credentials last updated {new Date(status.updated_at).toLocaleString()}
              </p>
            )}
          </section>

          {/* Setup steps */}
          <section className="space-y-2">
            <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              <ListOrdered className="h-3.5 w-3.5" /> Setup steps
            </h3>
            {integration.setupSteps.length === 0 ? (
              <p className="text-sm text-muted-foreground">No extra steps documented.</p>
            ) : (
              <ol className="list-decimal space-y-1.5 pl-5 text-sm text-muted-foreground">
                {integration.setupSteps.map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ol>
            )}
            {integration.docsUrl && (
              <a
                href={integration.docsUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
              >
                Provider docs <ExternalLink className="h-3 w-3" />
              </a>
            )}
          </section>
        </div>
      </SheetContent>
    </Sheet>
  );
}

export default IntegrationDetailsDrawer;
