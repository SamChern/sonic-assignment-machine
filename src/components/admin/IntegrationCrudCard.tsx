// Full CRUD + testing card for a single API / MCP integration.
// Create/update credentials, delete stored fields, run the provider's
// connection test, and fire a sample request to validate real responses.
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { Integration } from "@/config/integrations";
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
import { toast } from "sonner";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ExternalLink,
  Loader2,
  Network,
  PlayCircle,
  Plug,
  Save,
  Trash2,
  XCircle,
  Zap,
} from "lucide-react";
import { replaceLegacyBrandText } from "@/lib/brandText";

export interface StatusEntry {
  fields: string[];
  updated_at: string | null;
}
export interface TestEntry {
  integration_id: string;
  success: boolean;
  latency_ms: number | null;
  error_message: string | null;
  tested_at: string;
}

/** Sample request presets per integration — validates a real round-trip. */
const SAMPLE_REQUESTS: Record<
  string,
  { label: string; fn: string; body: Record<string, unknown> }
> = {
  apple_music: {
    label: 'Search Apple Music for "daft punk"',
    fn: "apple-music-search",
    body: { query: "daft punk", limit: 3 },
  },
  spotify: {
    label: 'Search Spotify for "daft punk"',
    fn: "spotify-search",
    body: { query: "daft punk", limit: 3 },
  },
  librosa_rest: {
    label: "Ping the librosa REST health route",
    fn: "librosa-rest-test",
    body: { integration_id: "librosa_rest" },
  },
};

const placeholderPattern = /your-ec2-host|example\.com|<.*?>|placeholder/i;

export const IntegrationCrudCard = ({
  integration,
  status,
  lastTest,
  statusLoading,
  onChanged,
}: {
  integration: Integration;
  status?: StatusEntry;
  lastTest?: TestEntry;
  statusLoading: boolean;
  onChanged: () => void;
}) => {
  const [values, setValues] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [sampling, setSampling] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [sample, setSample] = useState<{ ok: boolean; text: string } | null>(null);
  const [toolName, setToolName] = useState("");
  const [toolArgs, setToolArgs] = useState("{}");

  const requiredKeys = integration.fields.filter((f) => f.required).map((f) => f.key);
  const configured =
    integration.fields.length === 0
      ? true
      : status
        ? requiredKeys.every((k) => status.fields.includes(k))
        : false;

  const statusBadge = statusLoading ? (
    <Badge variant="outline" className="gap-1">
      <Loader2 className="h-3 w-3 animate-spin" /> Checking…
    </Badge>
  ) : lastTest && !lastTest.success ? (
    <Badge variant="destructive" className="gap-1">
      <XCircle className="h-3 w-3" /> Test failed
    </Badge>
  ) : lastTest?.success ? (
    <Badge className="gap-1 bg-green-600 hover:bg-green-600">
      <CheckCircle2 className="h-3 w-3" /> Verified
    </Badge>
  ) : configured ? (
    <Badge variant="secondary" className="gap-1">
      <CheckCircle2 className="h-3 w-3" /> Configured
    </Badge>
  ) : (
    <Badge variant="outline" className="gap-1 border-amber-600/50 text-amber-600">
      <AlertTriangle className="h-3 w-3" /> Not configured
    </Badge>
  );

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
    for (const [k, v] of Object.entries(payload)) {
      if (placeholderPattern.test(v)) {
        toast.error(`Field ${k} still contains a placeholder value.`);
        return;
      }
    }
    setSaving(true);
    const { data, error } = await supabase.functions.invoke("admin-set-credentials", {
      body: { integration_id: integration.id, credentials: payload },
    });
    setSaving(false);
    const errMsg = error?.message ?? (data as { error?: string })?.error;
    if (errMsg) return void toast.error(`Save failed: ${errMsg}`);
    toast.success("Connection settings saved");
    setValues({});
    onChanged();
  };

  const handleDelete = async (fieldKeys?: string[]) => {
    const label = fieldKeys?.length
      ? `Remove ${fieldKeys.join(", ")}?`
      : `Remove all stored settings for ${integration.name}?`;
    if (!window.confirm(label)) return;
    setDeleting(true);
    const { data, error } = await supabase.functions.invoke("admin-set-credentials", {
      body: {
        integration_id: integration.id,
        action: "delete",
        ...(fieldKeys?.length ? { field_keys: fieldKeys } : {}),
      },
    });
    setDeleting(false);
    const errMsg = error?.message ?? (data as { error?: string })?.error;
    if (errMsg) return void toast.error(`Delete failed: ${errMsg}`);
    toast.success("Settings removed");
    onChanged();
  };

  const handleTest = async () => {
    if (!integration.testEndpoint) {
      toast.info("No automated tester for this provider yet.");
      return;
    }
    setTesting(true);
    const { data, error } = await supabase.functions.invoke(integration.testEndpoint, {
      body: { integration_id: integration.id },
    });
    setTesting(false);
    if (error) toast.error(`Test failed: ${replaceLegacyBrandText(error.message)}`);
    else if ((data as { success?: boolean })?.success) {
      const ms = (data as { latency_ms?: number }).latency_ms;
      toast.success(`Connection OK${ms ? ` (${ms}ms)` : ""}`);
    } else {
      toast.error(
        `Test failed: ${replaceLegacyBrandText((data as { error?: string })?.error) ?? "Unknown"}`,
      );
    }
    onChanged();
  };

  const runSample = async () => {
    setSampling(true);
    setSample(null);
    try {
      let fn: string;
      let body: Record<string, unknown>;
      if (integration.kind === "mcp") {
        if (toolName.trim()) {
          let args: Record<string, unknown> = {};
          try {
            args = JSON.parse(toolArgs || "{}");
          } catch {
            setSample({ ok: false, text: "Arguments must be valid JSON." });
            setSampling(false);
            return;
          }
          fn = "mcp-call";
          body = {
            integration_id: integration.id,
            tool_name: toolName.trim(),
            arguments: args,
          };
        } else {
          fn = "mcp-call";
          body = { integration_id: integration.id, list_tools: true };
        }
      } else {
        const preset = SAMPLE_REQUESTS[integration.id];
        if (!preset) {
          setSample({
            ok: false,
            text: "No sample request defined for this provider — use Test connection.",
          });
          setSampling(false);
          return;
        }
        fn = preset.fn;
        body = preset.body;
      }
      const started = performance.now();
      const { data, error } = await supabase.functions.invoke(fn, { body });
      const ms = Math.round(performance.now() - started);
      if (error) {
        setSample({ ok: false, text: replaceLegacyBrandText(error.message) });
      } else if ((data as { success?: boolean })?.success === false) {
        setSample({
          ok: false,
          text: replaceLegacyBrandText((data as { error?: string }).error) ?? "Request failed",
        });
      } else {
        setSample({
          ok: true,
          text: `${ms}ms\n${JSON.stringify(data, null, 2).slice(0, 4000)}`,
        });
      }
    } finally {
      setSampling(false);
    }
  };

  const sampleLabel =
    integration.kind === "mcp"
      ? toolName.trim()
        ? `Call ${toolName.trim()}`
        : "List MCP tools"
      : (SAMPLE_REQUESTS[integration.id]?.label ?? "Sample request");

  return (
    <Card className="space-y-4 border-border/60 bg-card/70 p-4 backdrop-blur-sm sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-base font-semibold sm:text-lg">{integration.name}</h3>
            <Badge variant="outline" className="gap-1 text-xs">
              {integration.kind === "mcp" ? (
                <><Network className="h-3 w-3" /> MCP</>
              ) : (
                <><Plug className="h-3 w-3" /> REST</>
              )}
            </Badge>
            {statusBadge}
          </div>
          <p className="mt-1 text-sm text-muted-foreground">{integration.description}</p>
          {status?.updated_at && (
            <p className="mt-1 text-xs text-muted-foreground">
              Updated {new Date(status.updated_at).toLocaleString()}
            </p>
          )}
          {lastTest && (
            <p className="mt-1 text-xs text-muted-foreground">
              Last test {new Date(lastTest.tested_at).toLocaleString()}
              {lastTest.latency_ms ? ` · ${lastTest.latency_ms}ms` : ""}
              {lastTest.error_message
                ? ` — ${replaceLegacyBrandText(lastTest.error_message)}`
                : ""}
            </p>
          )}
        </div>
        <a
          href={integration.docsUrl}
          target="_blank"
          rel="noreferrer"
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          Docs <ExternalLink className="h-3 w-3" />
        </a>
      </div>

      {/* Connection settings (create / update) */}
      {integration.fields.length === 0 ? (
        <p className="rounded-md border border-dashed border-border bg-muted/30 p-3 text-xs text-muted-foreground">
          No credentials needed — this integration reuses another provider's settings.
        </p>
      ) : (
        <Collapsible>
          <CollapsibleTrigger asChild>
            <Button variant="outline" size="sm" className="gap-1">
              <ChevronDown className="h-4 w-4" /> Connection settings
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="mt-3 space-y-3">
            {integration.fields.map((field) => {
              const stored = status?.fields.includes(field.key);
              const id = `${integration.id}-${field.key}`;
              return (
                <div key={field.key} className="space-y-1">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <Label htmlFor={id} className="text-sm">
                      {field.label}
                      {field.required && <span className="ml-1 text-destructive">*</span>}
                    </Label>
                    {stored && (
                      <button
                        type="button"
                        onClick={() => void handleDelete([field.key])}
                        disabled={deleting}
                        className="text-xs text-muted-foreground hover:text-destructive"
                      >
                        •••• stored — remove
                      </button>
                    )}
                  </div>
                  {field.type === "textarea" ? (
                    <Textarea
                      id={id}
                      rows={5}
                      className="font-mono text-xs"
                      placeholder={stored ? "Leave blank to keep current value" : field.placeholder}
                      value={values[field.key] ?? ""}
                      onChange={(e) =>
                        setValues((v) => ({ ...v, [field.key]: e.target.value }))
                      }
                    />
                  ) : (
                    <Input
                      id={id}
                      type={field.type === "password" ? "password" : "text"}
                      placeholder={stored ? "Leave blank to keep current value" : field.placeholder}
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
            <div className="flex flex-wrap gap-2">
              <Button size="sm" onClick={() => void handleSave()} disabled={saving}>
                {saving ? (
                  <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                ) : (
                  <Save className="mr-1 h-4 w-4" />
                )}
                Save
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="text-destructive"
                onClick={() => void handleDelete()}
                disabled={deleting || !status}
              >
                <Trash2 className="mr-1 h-4 w-4" /> Delete all
              </Button>
            </div>
          </CollapsibleContent>
        </Collapsible>
      )}

      {/* Testing + sample request validation */}
      <div className="flex flex-wrap items-center gap-2 border-t border-border/60 pt-3">
        <Button size="sm" variant="secondary" onClick={() => void handleTest()} disabled={testing}>
          {testing ? (
            <Loader2 className="mr-1 h-4 w-4 animate-spin" />
          ) : (
            <Zap className="mr-1 h-4 w-4" />
          )}
          Test connection
        </Button>
        <Button size="sm" variant="outline" onClick={() => void runSample()} disabled={sampling}>
          {sampling ? (
            <Loader2 className="mr-1 h-4 w-4 animate-spin" />
          ) : (
            <PlayCircle className="mr-1 h-4 w-4" />
          )}
          {sampleLabel}
        </Button>
      </div>

      {integration.kind === "mcp" && (
        <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
          <div className="space-y-1">
            <Label htmlFor={`${integration.id}-tool`} className="text-xs">
              Tool name (blank = list tools)
            </Label>
            <Input
              id={`${integration.id}-tool`}
              value={toolName}
              placeholder="get_activations"
              onChange={(e) => setToolName(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor={`${integration.id}-args`} className="text-xs">
              Arguments (JSON)
            </Label>
            <Input
              id={`${integration.id}-args`}
              className="font-mono text-xs"
              value={toolArgs}
              onChange={(e) => setToolArgs(e.target.value)}
            />
          </div>
        </div>
      )}

      {sample && (
        <pre
          className={`max-h-64 overflow-auto rounded-md border p-3 text-xs ${
            sample.ok
              ? "border-green-600/40 bg-green-950/20"
              : "border-destructive/40 bg-destructive/10"
          }`}
        >
          {sample.text}
        </pre>
      )}
    </Card>
  );
};

export default IntegrationCrudCard;
