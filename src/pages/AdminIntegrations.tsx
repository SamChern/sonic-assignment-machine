import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
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
} from "lucide-react";

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
              <h1 className="text-xl font-semibold">API Integrations</h1>
            </div>
          </div>
          <Badge variant="outline" className="gap-1">
            <ShieldCheck className="h-3 w-3" /> Admin only
          </Badge>
        </div>
      </header>

      <main className="container mx-auto px-6 py-8 max-w-3xl space-y-6">
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
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);

  const requiredKeys = integration.fields.filter((f) => f.required).map((f) => f.key);
  const configured = status
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
    setTesting(true);
    const { data, error } = await supabase.functions.invoke(
      integration.testEndpoint,
    );
    setTesting(false);
    if (error) {
      toast.error(`Test failed: ${error.message}`);
    } else if (data && (data as { success: boolean }).success) {
      const latency = (data as { latency_ms?: number }).latency_ms;
      toast.success(`Connection OK${latency ? ` (${latency}ms)` : ""}`);
    } else {
      toast.error(
        `Test failed: ${(data as { error?: string })?.error ?? "Unknown"}`,
      );
    }
    onSaved();
  };

  return (
    <Card className="p-6 space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-semibold">{integration.name}</h2>
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
              {lastTest.error_message && ` — ${lastTest.error_message}`}
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

      <div className="flex items-center gap-2 pt-2">
        <Button onClick={handleSave} disabled={saving}>
          {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
          Save credentials
        </Button>
        <Button
          variant="outline"
          onClick={handleTest}
          disabled={testing || !configured}
        >
          {testing && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
          Test connection
        </Button>
      </div>
    </Card>
  );
}

export default AdminIntegrations;
