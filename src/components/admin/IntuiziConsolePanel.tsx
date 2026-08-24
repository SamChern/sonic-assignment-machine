import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import {
  Activity,
  AlertTriangle,
  ChevronDown,
  CloudDownload,
  Gauge,
  Loader2,
  Network,
  Play,
  RefreshCw,
  ShieldAlert,
  Terminal,
} from "lucide-react";
import {
  AUDIENCE_COMPLETED,
  asText,
  callTool,
  deliveredKeys,
  listTools,
  newIdempotencyKey,
  rows,
  statusId,
  statusLabel,
  unwrap,
  type EnvelopeRow,
  type McpTool,
} from "@/lib/intuiziMcp";

type BrowseKind = "projects" | "audiences" | "activations" | "cohorts";

const BROWSE_TOOL: Record<BrowseKind, string> = {
  projects: "list_projects",
  audiences: "list_audiences",
  activations: "list_activations",
  cohorts: "list_cohorts",
};

const REFERENCE_PRESETS = [
  { label: "Dataset types (common)", dataset: "common", catalog: "dataset-types" },
  { label: "Signal providers (common)", dataset: "common", catalog: "signal-providers" },
  { label: "CTV genres", dataset: "ctv", catalog: "genres" },
  { label: "App categories", dataset: "apps", catalog: "categories" },
];

interface PendingWrite {
  tool: string;
  args: Record<string, unknown>;
  label: string;
  destructive: boolean;
  onDone?: (resourceId: string | null, result: unknown) => void;
}

/**
 * Admin cockpit for the Intuizi console over MCP. Reads are one click; every
 * mutating tool routes through a confirm dialog and the backend write toggle.
 * Delivery keys hand off to the existing intuizi-ingest pipeline untouched.
 */
export const IntuiziConsolePanel = () => {
  const [tools, setTools] = useState<McpTool[]>([]);
  const [caps, setCaps] = useState<Record<string, boolean>>({});
  const [connError, setConnError] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(true);

  const [usage, setUsage] = useState<Record<string, unknown> | null>(null);
  const [kind, setKind] = useState<BrowseKind>("audiences");
  const [search, setSearch] = useState("");
  const [listRows, setListRows] = useState<EnvelopeRow[]>([]);
  const [listing, setListing] = useState(false);

  const [detail, setDetail] = useState<{ kind: BrowseKind; row: EnvelopeRow; raw: unknown } | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const [reference, setReference] = useState<string>("0");
  const [refText, setRefText] = useState<string>("");

  const [audienceBody, setAudienceBody] = useState<string>(
    JSON.stringify({ name: "SonicSIM test audience", datasets: [] }, null, 2),
  );
  const [flowLog, setFlowLog] = useState<string[]>([]);
  const [flowBusy, setFlowBusy] = useState(false);

  const [keys, setKeys] = useState<string[]>([]);
  const [ingesting, setIngesting] = useState(false);

  const [rawTool, setRawTool] = useState<string>("");
  const [rawArgs, setRawArgs] = useState<string>("{}");
  const [rawOut, setRawOut] = useState<string>("");
  const [rawBusy, setRawBusy] = useState(false);

  const [pending, setPending] = useState<PendingWrite | null>(null);

  const writeEnabled = caps["tools.write"] === true;
  const toolNames = useMemo(() => tools.map((t) => t.name).sort(), [tools]);

  const log = useCallback((line: string) => {
    setFlowLog((prev) => [...prev, `${new Date().toLocaleTimeString()} · ${line}`]);
  }, []);

  const connect = useCallback(async () => {
    setConnecting(true);
    setConnError(null);
    try {
      const res = await listTools();
      setTools(res.tools);
      setCaps(res.capabilities);
      if (!res.tools.length) setConnError("Handshake succeeded but the server exposed no tools.");
    } catch (e) {
      setConnError((e as Error).message);
      setTools([]);
    } finally {
      setConnecting(false);
    }
  }, []);

  // No auto-connect: without a saved MCP token the bridge answers 400, which
  // would surface as an error on every page load. Admin connects explicitly.
  useEffect(() => {
    setConnecting(false);
  }, []);


  const loadUsage = useCallback(async () => {
    try {
      const { result } = await callTool("get_usage", {});
      setUsage((unwrap<{ data?: unknown }>(result)?.data ?? null) as Record<string, unknown> | null);
    } catch (e) {
      toast.error("Usage read failed", { description: (e as Error).message });
    }
  }, []);

  const browse = useCallback(async () => {
    setListing(true);
    setDetail(null);
    try {
      const args: Record<string, unknown> = { per_page: 25 };
      if (search.trim()) args.search = search.trim();
      const { result } = await callTool(BROWSE_TOOL[kind], args);
      setListRows(rows(result));
    } catch (e) {
      toast.error(`Could not list ${kind}`, { description: (e as Error).message });
      setListRows([]);
    } finally {
      setListing(false);
    }
  }, [kind, search]);

  const openDetail = useCallback(async (row: EnvelopeRow) => {
    if (kind === "projects" || row.id == null) return;
    const tool = kind === "audiences" ? "get_audience" : kind === "activations" ? "get_activation" : "get_cohort";
    setDetailLoading(true);
    try {
      const { result } = await callTool(tool, { id: row.id });
      const detailRow = rows(result)[0] ?? row;
      setDetail({ kind, row: detailRow, raw: result });
      if (kind === "activations") setKeys(deliveredKeys(result));
    } catch (e) {
      toast.error("Detail read failed", { description: (e as Error).message });
    } finally {
      setDetailLoading(false);
    }
  }, [kind]);

  const loadReference = useCallback(async () => {
    const preset = REFERENCE_PRESETS[Number(reference)];
    try {
      const { result } = await callTool("lookup_reference", {
        dataset: preset.dataset,
        catalog: preset.catalog,
      });
      setRefText(asText(result).slice(0, 8000));
    } catch (e) {
      setRefText(`Error: ${(e as Error).message}`);
    }
  }, [reference]);

  const parseBody = (): Record<string, unknown> | null => {
    try {
      const parsed = JSON.parse(audienceBody);
      if (!parsed || typeof parsed !== "object") throw new Error("body must be a JSON object");
      return parsed as Record<string, unknown>;
    } catch (e) {
      toast.error("Invalid audience JSON", { description: (e as Error).message });
      return null;
    }
  };

  const runEstimate = useCallback(async () => {
    const body = parseBody();
    if (!body) return;
    setFlowBusy(true);
    setFlowLog([]);
    try {
      log("estimate_audience_size…");
      const { result } = await callTool("estimate_audience_size", body, {
        idempotencyKey: newIdempotencyKey(),
      });
      const id = rows(result)[0]?.id;
      if (!id) {
        log(asText(result).slice(0, 500));
        return;
      }
      log(`estimate ${id} queued — polling`);
      for (let i = 0; i < 20; i += 1) {
        await new Promise((r) => setTimeout(r, 3000));
        const poll = await callTool("get_audience_estimate", { id });
        const row = rows(poll.result)[0] ?? {};
        const st = String(typeof row.status === "string" ? row.status : statusLabel(row));
        log(`estimate status: ${st}`);
        if (["completed", "blocked", "failed"].includes(st.toLowerCase())) {
          log(asText(poll.result).slice(0, 1200));
          return;
        }
      }
      log("still running — poll again later");
    } catch (e) {
      log(`error: ${(e as Error).message}`);
    } finally {
      setFlowBusy(false);
    }
  }, [audienceBody, log]);

  const pollAudience = useCallback(async (id: string) => {
    for (let i = 0; i < 40; i += 1) {
      await new Promise((r) => setTimeout(r, 5000));
      const poll = await callTool("get_audience", { id });
      const row = rows(poll.result)[0] ?? {};
      const sid = statusId(row);
      log(`audience ${id}: ${statusLabel(row)}`);
      if (sid === AUDIENCE_COMPLETED) return true;
      if (sid != null && sid > AUDIENCE_COMPLETED) {
        log("audience ended in a non-completed state — stopping");
        return false;
      }
    }
    log("audience still building — re-open the panel later to activate it");
    return false;
  }, [log]);

  const requestCreateAudience = useCallback(() => {
    const body = parseBody();
    if (!body) return;
    setPending({
      tool: "create_audience",
      args: body,
      label: `Create audience "${String(body.name ?? "unnamed")}" in Intuizi. This consumes account quota.`,
      destructive: false,
      onDone: async (resourceId) => {
        if (!resourceId) {
          log("create_audience returned no id — check the raw output above");
          return;
        }
        log(`audience ${resourceId} created — polling to Completed (104)`);
        setFlowBusy(true);
        const ok = await pollAudience(resourceId).catch((e) => {
          log(`error: ${(e as Error).message}`);
          return false;
        });
        setFlowBusy(false);
        if (ok) log(`audience ${resourceId} is Completed — create an activation next`);
      },
    });
  }, [audienceBody, log, pollAudience]);

  const requestActivation = useCallback((audienceId: string, endpointId: string) => {
    setPending({
      tool: "create_activation",
      args: { audience_id: audienceId, endpoint_id: endpointId },
      label: `Activate audience ${audienceId} to endpoint ${endpointId}. Intuizi will deliver files to that destination.`,
      destructive: false,
      onDone: async (resourceId) => {
        if (!resourceId) return;
        log(`activation ${resourceId} created — polling delivery`);
        setFlowBusy(true);
        try {
          for (let i = 0; i < 40; i += 1) {
            await new Promise((r) => setTimeout(r, 5000));
            const poll = await callTool("get_activation", { id: resourceId });
            const row = rows(poll.result)[0] ?? {};
            log(`activation ${resourceId}: ${statusLabel(row)}`);
            const found = deliveredKeys(poll.result);
            if (found.length) {
              setKeys(found);
              log(`delivered ${found.length} object(s) — ready to ingest`);
              return;
            }
          }
          log("no delivery keys yet — check again shortly");
        } finally {
          setFlowBusy(false);
        }
      },
    });
  }, [log]);

  const confirmPending = useCallback(async () => {
    if (!pending) return;
    const p = pending;
    setPending(null);
    try {
      const { result, resourceId } = await callTool(p.tool, p.args, {
        confirm: true,
        idempotencyKey: newIdempotencyKey(),
      });
      toast.success(`${p.tool} ok`, { description: resourceId ? `id ${resourceId}` : undefined });
      setRawOut(asText(result).slice(0, 8000));
      await p.onDone?.(resourceId, result);
    } catch (e) {
      toast.error(`${p.tool} failed`, { description: (e as Error).message });
      log(`error: ${(e as Error).message}`);
    }
  }, [pending, log]);

  const ingestDelivered = useCallback(async () => {
    if (!keys.length) return;
    setIngesting(true);
    try {
      const { data: validated, error: vErr } = await supabase.functions.invoke("intuizi-ingest", {
        body: { action: "validate_keys", object_keys: keys, expand_manifest: true },
      });
      if (vErr) throw vErr;
      const readable = ((validated as { keys?: Array<{ object_key: string; ok: boolean }> })?.keys ?? [])
        .filter((k) => k.ok);
      if (!readable.length) {
        toast.error("No delivered object was readable", {
          description: "Check the S3 credentials on Integration Status.",
        });
        return;
      }
      let done = 0;
      for (const k of readable) {
        const { error } = await supabase.functions.invoke("intuizi-ingest", {
          body: { object_key: k.object_key },
        });
        if (!error) done += 1;
      }
      toast.success(`Ingested ${done}/${readable.length} delivered object(s)`, {
        description: "Scoring runs through the existing ontology pipeline.",
      });
    } catch (e) {
      toast.error("Ingest handoff failed", { description: (e as Error).message });
    } finally {
      setIngesting(false);
    }
  }, [keys]);

  const runRaw = useCallback(async () => {
    if (!rawTool) return;
    let args: Record<string, unknown> = {};
    try {
      args = JSON.parse(rawArgs || "{}");
    } catch (e) {
      toast.error("Arguments must be JSON", { description: (e as Error).message });
      return;
    }
    setRawBusy(true);
    try {
      const { result } = await callTool(rawTool, args);
      setRawOut(asText(result).slice(0, 12000));
    } catch (e) {
      const msg = (e as Error).message;
      if (msg.toLowerCase().includes("confirm required")) {
        setPending({
          tool: rawTool,
          args,
          label: `Run ${rawTool} against your Intuizi account.`,
          destructive: rawTool.startsWith("delete_"),
        });
      } else {
        setRawOut(`Error: ${msg}`);
      }
    } finally {
      setRawBusy(false);
    }
  }, [rawTool, rawArgs]);

  return (
    <Card className="p-5 space-y-5 border-primary/20 bg-gradient-to-b from-primary/5 to-transparent">
      <div className="flex flex-wrap items-center gap-2">
        <Network className="h-5 w-5 text-primary" />
        <h2 className="text-base font-semibold">Intuizi Console (MCP)</h2>
        {connecting ? (
          <Badge variant="outline" className="gap-1 text-[11px]">
            <Loader2 className="h-3 w-3 animate-spin" /> connecting
          </Badge>
        ) : connError ? (
          <Badge variant="destructive" className="text-[11px]">not connected</Badge>
        ) : (
          <Badge variant="outline" className="text-[11px] text-primary">
            {tools.length} tools
          </Badge>
        )}
        {!connecting && !connError && (
          <Badge variant={writeEnabled ? "default" : "outline"} className="text-[11px]">
            {writeEnabled ? "writes enabled" : "read-only"}
          </Badge>
        )}
        <div className="ml-auto flex gap-2">
          <Button variant="outline" size="sm" onClick={loadUsage} disabled={!!connError || connecting}>
            <Gauge className="mr-1 h-4 w-4" /> Usage
          </Button>
          <Button variant="outline" size="sm" onClick={connect} disabled={connecting}>
            <RefreshCw className="mr-1 h-4 w-4" /> Reconnect
          </Button>
        </div>
      </div>

      {connError && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-xs">
          <p className="flex items-center gap-2 font-medium text-destructive">
            <AlertTriangle className="h-3.5 w-3.5" /> {connError}
          </p>
          <p className="mt-1 text-muted-foreground">
            Paste an MCP token in the “Intuizi Console MCP” card above (Intuizi console → My Account →
            MCP Tokens), then hit Reconnect.
          </p>
        </div>
      )}

      {usage && (
        <div className="rounded-lg border border-border bg-muted/20 p-3 text-[11px] font-mono break-all">
          {JSON.stringify(usage).slice(0, 600)}
        </div>
      )}

      {!connError && !connecting && (
        <>
          <Tabs value={kind} onValueChange={(v) => setKind(v as BrowseKind)}>
            <TabsList className="grid w-full grid-cols-4">
              <TabsTrigger value="audiences" className="text-xs">Audiences</TabsTrigger>
              <TabsTrigger value="activations" className="text-xs">Activations</TabsTrigger>
              <TabsTrigger value="cohorts" className="text-xs">Cohorts</TabsTrigger>
              <TabsTrigger value="projects" className="text-xs">Projects</TabsTrigger>
            </TabsList>
            <TabsContent value={kind} className="mt-3 space-y-3">
              <div className="flex gap-2">
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder={`Search ${kind}…`}
                  className="h-9 text-xs"
                />
                <Button size="sm" onClick={browse} disabled={listing}>
                  {listing ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Activity className="mr-1 h-4 w-4" />}
                  Load
                </Button>
              </div>

              <div className="space-y-1">
                {listRows.map((row) => (
                  <button
                    key={String(row.id)}
                    onClick={() => void openDetail(row)}
                    className="w-full rounded-lg border border-border/60 bg-card/60 p-2 text-left transition-colors hover:border-primary/50"
                  >
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="truncate text-xs font-medium">{row.name ?? `#${row.id}`}</span>
                      <span className="shrink-0 text-[11px] text-muted-foreground">{statusLabel(row)}</span>
                    </div>
                    <span className="font-mono text-[10px] text-muted-foreground">id {String(row.id)}</span>
                  </button>
                ))}
                {!listRows.length && !listing && (
                  <p className="text-[11px] text-muted-foreground">Nothing loaded yet.</p>
                )}
              </div>

              {detailLoading && <Loader2 className="h-4 w-4 animate-spin text-primary" />}

              {detail && (
                <div className="rounded-lg border border-primary/30 bg-primary/5 p-3 space-y-2">
                  <p className="text-xs font-medium">
                    {detail.row.name ?? `#${detail.row.id}`} · {statusLabel(detail.row)}
                  </p>
                  {!!detail.row.eligibility && (
                    <pre className="max-h-40 overflow-auto rounded bg-background/60 p-2 text-[10px]">
                      {JSON.stringify(detail.row.eligibility, null, 2)}
                    </pre>
                  )}
                  {!!detail.row.totals && (
                    <pre className="max-h-32 overflow-auto rounded bg-background/60 p-2 text-[10px]">
                      {JSON.stringify(detail.row.totals, null, 2)}
                    </pre>
                  )}
                  {detail.kind === "audiences" && statusId(detail.row) === AUDIENCE_COMPLETED && (
                    <ActivationLauncher
                      disabled={!writeEnabled}
                      onActivate={(endpointId) => requestActivation(String(detail.row.id), endpointId)}
                    />
                  )}
                  <Collapsible>
                    <CollapsibleTrigger className="flex items-center gap-1 text-[11px] text-muted-foreground">
                      <ChevronDown className="h-3 w-3" /> raw payload
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                      <pre className="mt-1 max-h-56 overflow-auto rounded bg-background/60 p-2 text-[10px]">
                        {asText(detail.raw).slice(0, 6000)}
                      </pre>
                    </CollapsibleContent>
                  </Collapsible>
                </div>
              )}
            </TabsContent>
          </Tabs>

          {/* Delivery handoff into the untouched ingest pipeline */}
          <div className="rounded-lg border border-border bg-muted/20 p-3">
            <div className="flex flex-wrap items-center gap-2">
              <CloudDownload className="h-4 w-4 text-primary" />
              <p className="text-xs font-medium">Delivered objects</p>
              <Badge variant="outline" className="text-[11px]">{keys.length}</Badge>
              <Button
                size="sm"
                className="ml-auto"
                onClick={ingestDelivered}
                disabled={!keys.length || ingesting}
              >
                {ingesting ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Play className="mr-1 h-4 w-4" />}
                Ingest these
              </Button>
            </div>
            {keys.length ? (
              <ul className="mt-2 space-y-1">
                {keys.map((k) => (
                  <li key={k} className="font-mono text-[10px] break-all text-muted-foreground">• {k}</li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-[11px] text-muted-foreground">
                Open a completed activation above — its delivery keys land here and go straight into
                `intuizi-ingest` (taxonomy tagging → six-category scoring → calibration → speech-skew
                normalization, all unchanged).
              </p>
            )}
          </div>

          {/* Reference catalogs */}
          <div className="flex flex-wrap items-end gap-2">
            <div className="min-w-[220px]">
              <Label className="text-[11px]">Reference catalog</Label>
              <Select value={reference} onValueChange={setReference}>
                <SelectTrigger className="h-9 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {REFERENCE_PRESETS.map((p, i) => (
                    <SelectItem key={p.label} value={String(i)}>{p.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button variant="outline" size="sm" onClick={loadReference}>Lookup</Button>
            {!!refText && (
              <pre className="mt-2 max-h-40 w-full overflow-auto rounded bg-muted/30 p-2 text-[10px]">{refText}</pre>
            )}
          </div>

          {/* Guided build */}
          <Collapsible>
            <CollapsibleTrigger className="flex w-full items-center gap-2 rounded-lg border border-border bg-card/60 p-2 text-xs font-medium">
              <ChevronDown className="h-3.5 w-3.5" /> Guided audience build (estimate → create → poll → activate)
            </CollapsibleTrigger>
            <CollapsibleContent className="mt-2 space-y-2">
              <Textarea
                value={audienceBody}
                onChange={(e) => setAudienceBody(e.target.value)}
                rows={8}
                spellCheck={false}
                className="font-mono text-[11px]"
              />
              <p className="text-[11px] text-muted-foreground">
                Body follows the documented `create_audience` contract — the same JSON is used for the
                read-only estimate. A `WebDomain` block's `start_date` is limited to the last 45 days.
              </p>
              <div className="flex flex-wrap gap-2">
                <Button variant="secondary" size="sm" onClick={runEstimate} disabled={flowBusy}>
                  {flowBusy ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}
                  Estimate size (read-only)
                </Button>
                <Button size="sm" onClick={requestCreateAudience} disabled={flowBusy || !writeEnabled}>
                  Create audience…
                </Button>
                {!writeEnabled && (
                  <span className="flex items-center gap-1 text-[11px] text-amber-500">
                    <ShieldAlert className="h-3 w-3" /> enable the write capability to create
                  </span>
                )}
              </div>
              {!!flowLog.length && (
                <pre className="max-h-48 overflow-auto rounded bg-muted/30 p-2 text-[10px]">
                  {flowLog.join("\n")}
                </pre>
              )}
            </CollapsibleContent>
          </Collapsible>

          {/* Raw tool console */}
          <Collapsible>
            <CollapsibleTrigger className="flex w-full items-center gap-2 rounded-lg border border-border bg-card/60 p-2 text-xs font-medium">
              <Terminal className="h-3.5 w-3.5" /> Raw tool console
            </CollapsibleTrigger>
            <CollapsibleContent className="mt-2 space-y-2">
              <div className="flex flex-wrap gap-2">
                <Select value={rawTool} onValueChange={setRawTool}>
                  <SelectTrigger className="h-9 w-[260px] text-xs">
                    <SelectValue placeholder="Pick a tool" />
                  </SelectTrigger>
                  <SelectContent>
                    {toolNames.map((n) => (
                      <SelectItem key={n} value={n}>{n}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button size="sm" onClick={runRaw} disabled={!rawTool || rawBusy}>
                  {rawBusy ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Play className="mr-1 h-4 w-4" />}
                  Run
                </Button>
              </div>
              <Textarea
                value={rawArgs}
                onChange={(e) => setRawArgs(e.target.value)}
                rows={4}
                spellCheck={false}
                className="font-mono text-[11px]"
              />
              {!!rawOut && (
                <pre className="max-h-64 overflow-auto rounded bg-muted/30 p-2 text-[10px]">{rawOut}</pre>
              )}
            </CollapsibleContent>
          </Collapsible>
        </>
      )}

      <AlertDialog open={!!pending} onOpenChange={(o) => !o && setPending(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {pending?.destructive ? "Destructive Intuizi action" : "Confirm Intuizi write"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {pending?.label} Every call is recorded in the Intuizi run ledger.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <pre className="max-h-40 overflow-auto rounded bg-muted/30 p-2 text-[10px]">
            {JSON.stringify(pending?.args ?? {}, null, 2)}
          </pre>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmPending}>
              Run {pending?.tool}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
};

const ActivationLauncher = ({
  disabled,
  onActivate,
}: {
  disabled: boolean;
  onActivate: (endpointId: string) => void;
}) => {
  const [endpointId, setEndpointId] = useState("");
  return (
    <div className="flex flex-wrap items-end gap-2">
      <div className="min-w-[180px]">
        <Label className="text-[11px]">Endpoint connection id</Label>
        <Input
          value={endpointId}
          onChange={(e) => setEndpointId(e.target.value)}
          placeholder="S3 endpoint connection id"
          className="h-9 text-xs"
        />
      </div>
      <Button size="sm" disabled={disabled || !endpointId.trim()} onClick={() => onActivate(endpointId.trim())}>
        Activate…
      </Button>
    </div>
  );
};

export default IntuiziConsolePanel;
