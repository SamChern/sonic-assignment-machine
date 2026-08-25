import { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { INTEGRATIONS, type Integration } from "@/config/integrations";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { McpResultView } from "@/components/admin/McpResultView";
import { McpToolForm } from "@/components/admin/McpToolForm";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import {
  CheckCircle2,
  XCircle,
  Loader2,
  Plug,
  Network,
  Settings2,
  Play,
  Zap,
} from "lucide-react";

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

/** Providers whose credentials exist and whose most recent test passed. */
export function verifiedIntegrations(
  status: Record<string, StatusEntry>,
  lastTest: Record<string, TestEntry>,
): Integration[] {
  return INTEGRATIONS.filter((i) => {
    if (i.fields.length === 0) return false;
    const required = i.fields.filter((f) => f.required).map((f) => f.key);
    const entry = status[i.id];
    if (!entry) return false;
    const hasCreds =
      required.length === 0
        ? entry.fields.length > 0
        : required.every((k) => entry.fields.includes(k));
    return hasCreds && lastTest[i.id]?.success === true;
  });
}

/** Connected-only console: no setup forms, just call what is already wired. */
export function ConnectedIntegrationsPanel({
  status,
  lastTest,
  statusLoading,
  onRefresh,
  onOpenSetup,
}: {
  status: Record<string, StatusEntry>;
  lastTest: Record<string, TestEntry>;
  statusLoading: boolean;
  onRefresh: () => void;
  onOpenSetup: () => void;
}) {
  const connected = useMemo(() => verifiedIntegrations(status, lastTest), [status, lastTest]);
  const rest = connected.filter((i) => i.kind === "rest");
  const mcp = connected.filter((i) => i.kind === "mcp");

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">
        Only providers whose last connection test passed. Call them directly — no
        configuration forms here.
      </p>

      {statusLoading && connected.length === 0 && (
        <Card className="p-8 flex items-center justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-primary" />
        </Card>
      )}

      {!statusLoading && connected.length === 0 && (
        <Card className="p-8 text-center space-y-3">
          <p className="text-sm text-muted-foreground">
            No verified connections yet. Save credentials and run a successful test
            on the Needs setup tab first.
          </p>
          <Button size="sm" onClick={onOpenSetup}>
            <Settings2 className="h-4 w-4 mr-1" /> Go to Needs setup
          </Button>
        </Card>
      )}

      {mcp.length > 0 && (
        <section className="space-y-4">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-2">
            <Network className="h-4 w-4" /> MCP servers
          </h2>
          {mcp.map((i) => (
            <ConnectedCard key={i.id} integration={i} lastTest={lastTest[i.id]} onTested={onRefresh} />
          ))}
        </section>
      )}

      {rest.length > 0 && (
        <section className="space-y-4">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-2">
            <Plug className="h-4 w-4" /> REST APIs
          </h2>
          {rest.map((i) => (
            <ConnectedCard key={i.id} integration={i} lastTest={lastTest[i.id]} onTested={onRefresh} />
          ))}
        </section>
      )}
    </div>
  );
}

interface McpTool {
  name: string;
  description?: string;
  inputSchema?: unknown;
}

function ConnectedCard({
  integration,
  lastTest,
  onTested,
}: {
  integration: Integration;
  lastTest?: TestEntry;
  onTested: () => void;
}) {
  const [testing, setTesting] = useState(false);
  const [tools, setTools] = useState<McpTool[] | null>(null);
  const [loadingTools, setLoadingTools] = useState(false);
  const [selectedTool, setSelectedTool] = useState<string>("");
  const [argsJson, setArgsJson] = useState("{}");
  const [formArgs, setFormArgs] = useState<Record<string, unknown>>({});
  const [jsonMode, setJsonMode] = useState(false);
  const [calling, setCalling] = useState(false);
  const [output, setOutput] = useState<string | null>(null);
  const [resultObj, setResultObj] = useState<unknown>(null);

  const handleTest = async () => {
    if (!integration.testEndpoint) {
      toast.info("No automated tester for this provider.");
      return;
    }
    setTesting(true);
    const { data, error } = await supabase.functions.invoke(integration.testEndpoint, {
      body: { integration_id: integration.id },
    });
    setTesting(false);
    if (error) toast.error(`Test failed: ${error.message}`);
    else if ((data as { success?: boolean })?.success) {
      const ms = (data as { latency_ms?: number }).latency_ms;
      toast.success(`Connection OK${ms ? ` (${ms}ms)` : ""}`);
    } else {
      toast.error(`Test failed: ${(data as { error?: string })?.error ?? "Unknown"}`);
    }
    onTested();
  };

  const loadTools = async () => {
    setLoadingTools(true);
    const { data, error } = await supabase.functions.invoke("mcp-call", {
      body: { integration_id: integration.id, list_tools: true },
    });
    setLoadingTools(false);
    if (error || (data as { success?: boolean })?.success === false) {
      toast.error(
        `Could not list tools: ${
          (data as { error?: string })?.error ?? error?.message ?? "Unknown"
        }`,
      );
      return;
    }
    const result = (data as { result?: unknown }).result as
      | { tools?: McpTool[] }
      | undefined;
    const list = result?.tools ?? (data as { tools?: McpTool[] }).tools ?? [];
    setTools(list);
    if (list.length > 0) setSelectedTool(list[0].name);
  };

  const callTool = async () => {
    let parsed: Record<string, unknown> = formArgs;
    if (jsonMode) {
      try {
        parsed = argsJson.trim() ? JSON.parse(argsJson) : {};
      } catch {
        toast.error("Arguments must be valid JSON.");
        return;
      }
    }
    setCalling(true);
    setOutput(null);
    setResultObj(null);
    const { data, error } = await supabase.functions.invoke("mcp-call", {
      body: {
        integration_id: integration.id,
        tool_name: selectedTool,
        arguments: parsed,
      },
    });
    setCalling(false);
    if (error) {
      setOutput(error.message);
      toast.error("Call failed");
      return;
    }
    if ((data as { success?: boolean })?.success === false) {
      setOutput((data as { error?: string }).error ?? "Unknown error");
      toast.error("Call failed");
      return;
    }
    setResultObj((data as { result?: unknown }).result ?? data);
    toast.success("Call complete");
  };

  const badge = lastTest ? (
    lastTest.success ? (
      <Badge className="gap-1 bg-green-600 hover:bg-green-600">
        <CheckCircle2 className="h-3 w-3" /> Verified
      </Badge>
    ) : (
      <Badge variant="destructive" className="gap-1">
        <XCircle className="h-3 w-3" /> Last test failed
      </Badge>
    )
  ) : (
    <Badge variant="secondary" className="gap-1">
      <CheckCircle2 className="h-3 w-3" /> Connected
    </Badge>
  );

  return (
    <Card className="p-4 sm:p-6 space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <h3 className="font-semibold">{integration.name}</h3>
          <p className="text-xs text-muted-foreground">{integration.description}</p>
        </div>
        {badge}
      </div>

      <div className="flex flex-wrap gap-2">
        {integration.testEndpoint && (
          <Button size="sm" variant="outline" onClick={handleTest} disabled={testing}>
            {testing ? (
              <Loader2 className="h-4 w-4 mr-1 animate-spin" />
            ) : (
              <Zap className="h-4 w-4 mr-1" />
            )}
            Test
          </Button>
        )}
        {integration.kind === "mcp" && (
          <Button size="sm" variant="secondary" onClick={loadTools} disabled={loadingTools}>
            {loadingTools ? (
              <Loader2 className="h-4 w-4 mr-1 animate-spin" />
            ) : (
              <Network className="h-4 w-4 mr-1" />
            )}
            {tools ? "Reload tools" : "Load tools"}
          </Button>
        )}
      </div>

      {integration.kind === "mcp" && tools && (
        <div className="space-y-3 rounded-lg border border-border/60 p-3">
          {tools.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              Server exposed no tools.
            </p>
          ) : (
            <>
              <div className="space-y-1">
                <Label className="text-xs">Tool</Label>
                <select
                  className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
                  value={selectedTool}
                  onChange={(e) => {
                    setSelectedTool(e.target.value);
                    setFormArgs({});
                    setArgsJson("{}");
                    setOutput(null);
                  }}
                >
                  {tools.map((t) => (
                    <option key={t.name} value={t.name}>
                      {t.name}
                    </option>
                  ))}
                </select>
                {tools.find((t) => t.name === selectedTool)?.description && (
                  <p className="text-xs text-muted-foreground">
                    {tools.find((t) => t.name === selectedTool)?.description}
                  </p>
                )}
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <Label className="text-xs">Arguments</Label>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 text-[11px]"
                    onClick={() => {
                      if (!jsonMode) setArgsJson(JSON.stringify(formArgs, null, 2));
                      setJsonMode((v) => !v);
                    }}
                  >
                    {jsonMode ? "Use form fields" : "Edit as JSON"}
                  </Button>
                </div>
                {jsonMode ? (
                  <Textarea
                    rows={4}
                    value={argsJson}
                    onChange={(e) => setArgsJson(e.target.value)}
                    className="font-mono text-xs"
                  />
                ) : (
                  <McpToolForm
                    schema={tools.find((t) => t.name === selectedTool)?.inputSchema}
                    resetKey={selectedTool}
                    onChange={setFormArgs}
                  />
                )}
              </div>
              <Button size="sm" onClick={callTool} disabled={calling || !selectedTool}>
                {calling ? (
                  <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                ) : (
                  <Play className="h-4 w-4 mr-1" />
                )}
                Call tool
              </Button>
              {resultObj !== null && (
                <McpResultView result={resultObj} toolName={selectedTool} />
              )}
              {output && (
                <pre className="max-h-64 overflow-auto rounded bg-muted/50 p-3 text-xs whitespace-pre-wrap break-words">
                  {output}
                </pre>
              )}
            </>
          )}
        </div>
      )}

      {integration.kind === "rest" && lastTest?.error_message && (
        <p className="text-xs text-destructive break-words">
          {lastTest.error_message}
        </p>
      )}
    </Card>
  );
}

export default AdminConnected;
