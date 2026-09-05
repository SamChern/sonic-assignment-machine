import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { INTEGRATIONS, type Integration, type IntegrationKind } from "@/config/integrations";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  ConnectedIntegrationsPanel,
  verifiedIntegrations,
} from "@/components/admin/ConnectedIntegrationsPanel";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import {
  ArrowLeft,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Loader2,
  ExternalLink,
  ChevronDown,
  ShieldCheck,
  Plug,
  Network,
  Zap,
  Settings2,
  RefreshCw,
} from "lucide-react";
import { IntegrationDetailsDrawer } from "@/components/admin/IntegrationDetailsDrawer";
import { LibrosaAudioTester } from "@/components/admin/LibrosaAudioTester";
import IntuiziConsolePanel from "@/components/admin/IntuiziConsolePanel";
import { replaceLegacyBrandText } from "@/lib/brandText";

interface StatusEntry {
  fields: string[];
  updated_at: string | null;
}
interface TestEntry {
  integration_id: string;
  success: boolean;
  latency_ms: number | null;
  error_message: string | null;
  tested_at: string;
}

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
  const view = searchParams.get("view") === "connected" ? "connected" : "setup";
  const setView = (v: "connected" | "setup") => {
    const next = new URLSearchParams(searchParams);
    if (v === "connected") next.set("view", "connected");
    else next.delete("view");
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
            <Button variant="ghost" size="sm" onClick={refreshStatus} disabled={statusLoading} aria-label="Refresh integration status">
              <RefreshCw className={`h-4 w-4 ${statusLoading ? "animate-spin" : ""}`} />
            </Button>
            <Badge variant="outline" className="gap-1">
              <ShieldCheck className="h-3 w-3" /> Admin only
            </Badge>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-6 py-8 max-w-3xl space-y-6">
        <Tabs value={view} onValueChange={(v) => setView(v as "connected" | "setup")}>
          <TabsList className="grid w-full max-w-md grid-cols-2">
            <TabsTrigger value="connected" className="gap-1">
              <Zap className="h-3.5 w-3.5" /> Connected ({connectedCount})
            </TabsTrigger>
            <TabsTrigger value="setup" className="gap-1">
              <Settings2 className="h-3.5 w-3.5" /> Needs setup ({setupCount})
            </TabsTrigger>
          </TabsList>
        </Tabs>

        {view === "connected" ? (
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
          Manage credentials for third-party APIs and Model Context Protocol
          (MCP) servers. Credentials are stored server-side and only readable
          by edge functions. Use{" "}
          <span className="font-medium">Test Connection</span> to validate
          before relying on them in features.
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

        {INTEGRATIONS.filter((i) => i.kind === kindFilter).map((integration) => (
          <IntegrationCard
            key={integration.id}
            integration={integration}
            status={statusByIntegration[integration.id]}
            lastTest={lastTestByIntegration[integration.id]}
            statusLoading={statusLoading}
            onSaved={refreshStatus}
          />
        ))}

        {INTEGRATIONS.filter((i) => i.kind === kindFilter).length === 0 && (
          <Card className="p-8 text-center text-sm text-muted-foreground">
            No {kindFilter === "mcp" ? "MCP servers" : "REST APIs"} configured
            in the registry yet.
          </Card>
        )}

        {kindFilter === "mcp" && <IntuiziConsolePanel />}
        {kindFilter === "mcp" && <LibrosaAudioTester />}
        </div>
        )}
      </main>
    </div>
  );
};

function IntegrationCard({
  integration,
  status,
  lastTest,
  statusLoading,
  onSaved,
}: {
  integration: Integration;
  status?: StatusEntry;
  lastTest?: TestEntry;
  statusLoading: boolean;
  onSaved: () => void;
}) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);

  const capFieldKey = (capKey: string) =>
    `MCP_CAP_${capKey.toUpperCase().replace(/\./g, "_")}`;

  const requiredKeys = integration.fields.filter((f) => f.required).map((f) => f.key);
  // Integrations with no fields (e.g. those that reuse another card's creds)
  // are considered "configured" by default — verification happens via the tester.
  const configured = integration.fields.length === 0
    ? true
    : status
      ? requiredKeys.every((k) => status.fields.includes(k))
      : false;

  const statusBadge = (() => {
    if (statusLoading) {
      return (
        <Badge variant="outline" className="gap-1">
          <Loader2 className="h-3 w-3 animate-spin" /> Checking…
        </Badge>
      );
    }
    if (lastTest && !lastTest.success) {
      return (
        <Badge variant="destructive" className="gap-1">
          <XCircle className="h-3 w-3" /> Test failed
        </Badge>
      );
    }
    if (lastTest && lastTest.success) {
      return (
        <Badge className="gap-1 bg-green-600 hover:bg-green-600">
          <CheckCircle2 className="h-3 w-3" /> Verified
        </Badge>
      );
    }
    if (configured) {
      return (
        <Badge variant="secondary" className="gap-1">
          <CheckCircle2 className="h-3 w-3" /> Configured
        </Badge>
      );
    }
    return (
      <Badge variant="outline" className="gap-1 text-amber-600 border-amber-600/50">
        <AlertTriangle className="h-3 w-3" /> Not configured
      </Badge>
    );
  })();

  const handleSave = async () => {
    const payload: Record<string, string> = {};
    for (const f of integration.fields) {
      const v = values[f.key]?.trim();
      if (v) payload[f.key] = v;
    }
    if (Object.keys(payload).length === 0) {
      toast.error("Enter at least one field to save.");
      return;
    }
    // Reject obvious placeholder values that won't resolve at runtime.
    const placeholderPattern = /your-ec2-host|example\.com|<.*?>|placeholder/i;
    for (const [k, v] of Object.entries(payload)) {
      if (placeholderPattern.test(v)) {
        toast.error(
          `Field ${k} still contains a placeholder value — replace it with a real URL/token before saving.`,
        );
        return;
      }
    }
    setSaving(true);
    const { data, error } = await supabase.functions.invoke(
      "admin-set-credentials",
      {
        body: { integration_id: integration.id, credentials: payload },
      },
    );
    setSaving(false);
    if (error || (data && (data as { error?: string }).error)) {
      toast.error(
        `Save failed: ${error?.message ?? (data as { error?: string }).error}`,
      );
      return;
    }
    toast.success("Credentials saved");
    setValues({});
    onSaved();
  };

  const handleTest = async () => {
    if (!integration.testEndpoint) {
      toast.info(
        "No automated tester for this provider yet — credentials will be validated when first used.",
      );
      return;
    }
    setTesting(true);
    const { data, error } = await supabase.functions.invoke(
      integration.testEndpoint,
      { body: { integration_id: integration.id } },
    );
    setTesting(false);
    if (error) {
      toast.error(`Test failed: ${replaceLegacyBrandText(error.message)}`);
    } else if (data && (data as { success: boolean }).success) {
      const latency = (data as { latency_ms?: number }).latency_ms;
      toast.success(`Connection OK${latency ? ` (${latency}ms)` : ""}`);
    } else {
      toast.error(
        `Test failed: ${replaceLegacyBrandText((data as { error?: string })?.error) ?? "Unknown"}`,
      );
    }
    onSaved();
  };

  return (
    <Card className="p-6 space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="text-lg font-semibold">{integration.name}</h2>
            <Badge variant="outline" className="gap-1 text-xs">
              {integration.kind === "mcp" ? (
                <><Network className="h-3 w-3" /> MCP</>
              ) : (
                <><Plug className="h-3 w-3" /> REST</>
              )}
            </Badge>
            {statusBadge}
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            {integration.description}
          </p>
          {status?.updated_at && (
            <p className="text-xs text-muted-foreground mt-1">
              Last updated {new Date(status.updated_at).toLocaleString()}
            </p>
          )}
          {lastTest && (
            <p className="text-xs text-muted-foreground mt-1">
              Last test {new Date(lastTest.tested_at).toLocaleString()}
              {lastTest.error_message && ` — ${replaceLegacyBrandText(lastTest.error_message)}`}
            </p>
          )}
        </div>
        <a
          href={integration.docsUrl}
          target="_blank"
          rel="noreferrer"
          className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
        >
          Docs <ExternalLink className="h-3 w-3" />
        </a>
      </div>

      <Collapsible>
        <CollapsibleTrigger asChild>
          <Button variant="outline" size="sm" className="gap-1">
            <ChevronDown className="h-4 w-4" /> Setup guide
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent className="mt-3">
          <ol className="list-decimal list-inside space-y-1 text-sm text-muted-foreground bg-muted/40 rounded-md p-4">
            {integration.setupSteps.map((step, i) => (
              <li key={i}>{step}</li>
            ))}
          </ol>
        </CollapsibleContent>
      </Collapsible>

      {integration.fields.length === 0 ? (
        <div className="rounded-md border border-dashed border-border bg-muted/30 p-3 text-xs text-muted-foreground">
          No credentials needed for this integration — it reuses settings from
          another card. Click <span className="font-medium">Test connection</span> to verify it's working end-to-end.
        </div>
      ) : (
        <div className="space-y-3">
          {integration.fields.map((field) => {
            const isConfigured = status?.fields.includes(field.key);
            return (
              <div key={field.key} className="space-y-1">
                <div className="flex items-center justify-between">
                  <Label htmlFor={`${integration.id}-${field.key}`}>
                    {field.label}
                    {field.required && (
                      <span className="text-destructive ml-1">*</span>
                    )}
                  </Label>
                  {isConfigured && (
                    <span className="text-xs text-muted-foreground">
                      •••• stored
                    </span>
                  )}
                </div>
                {field.type === "textarea" ? (
                  <Textarea
                    id={`${integration.id}-${field.key}`}
                    placeholder={
                      isConfigured
                        ? "Leave blank to keep current value"
                        : field.placeholder
                    }
                    rows={6}
                    className="font-mono text-xs"
                    value={values[field.key] ?? ""}
                    onChange={(e) =>
                      setValues((v) => ({ ...v, [field.key]: e.target.value }))
                    }
                  />
                ) : (
                  <Input
                    id={`${integration.id}-${field.key}`}
                    type={field.type === "password" ? "password" : "text"}
                    placeholder={
                      isConfigured
                        ? "Leave blank to keep current value"
                        : field.placeholder
                    }
                    value={values[field.key] ?? ""}
                    onChange={(e) =>
                      setValues((v) => ({ ...v, [field.key]: e.target.value }))
                    }
                  />
                )}
                <p className="text-xs text-muted-foreground">{field.helpText}</p>
              </div>
            );
          })}
        </div>
      )}

      {integration.kind === "mcp" && integration.capabilities && (
        <div className="space-y-2 pt-2 border-t border-border">
          <Label className="text-sm font-medium">Capabilities</Label>
          <p className="text-xs text-muted-foreground">
            Choose which MCP capabilities this server is allowed to expose. Saved
            with the credentials.
          </p>
          <div className="space-y-2">
            {integration.capabilities.map((cap) => {
              const fk = capFieldKey(cap.key);
              const stored = status?.fields.includes(fk);
              const checked =
                values[fk] !== undefined
                  ? values[fk] === "true"
                  : stored ?? cap.defaultEnabled;
              return (
                <div
                  key={cap.key}
                  className="flex items-start gap-2 rounded-md border border-border p-3"
                >
                  <Checkbox
                    id={`${integration.id}-${fk}`}
                    checked={checked}
                    onCheckedChange={(v) =>
                      setValues((vv) => ({
                        ...vv,
                        [fk]: v ? "true" : "false",
                      }))
                    }
                    className="mt-0.5"
                  />
                  <div className="space-y-0.5 flex-1">
                    <Label
                      htmlFor={`${integration.id}-${fk}`}
                      className="text-sm font-medium cursor-pointer"
                    >
                      {cap.label}
                    </Label>
                    <p className="text-xs text-muted-foreground">
                      {cap.description}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="flex items-center gap-2 pt-2">
        {integration.fields.length > 0 && (
          <Button onClick={handleSave} disabled={saving}>
            {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Save credentials
          </Button>
        )}
        <Button
          variant="outline"
          onClick={handleTest}
          disabled={
            testing ||
            !integration.testEndpoint ||
            (integration.fields.length > 0 && !configured)
          }
          title={
            !integration.testEndpoint
              ? "No automated tester for this provider yet"
              : undefined
          }
        >
          {testing && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
          {integration.testEndpoint ? "Test connection" : "Test (n/a)"}
        </Button>
        <Button variant="ghost" onClick={() => setDetailsOpen(true)}>
          Details
        </Button>
      </div>

      <IntegrationDetailsDrawer
        integration={integration}
        status={status}
        lastTest={lastTest}
        open={detailsOpen}
        onOpenChange={setDetailsOpen}
        onTested={onSaved}
      />
    </Card>

  );
}

export default AdminIntegrations;
