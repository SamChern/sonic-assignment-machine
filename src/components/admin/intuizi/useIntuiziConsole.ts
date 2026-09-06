import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
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
import {
  buildCatalogTree,
  extractCatalogArray,
  normalizeCatalogRows,
  type CatalogNode,
} from "@/lib/intuiziTaxonomy";
import { BROWSE_TOOL, type BrowseKind, type PendingWrite } from "./types";

/** All Intuizi console state + callbacks, kept out of the render component. */
export const useIntuiziConsole = () => {
  const navigate = useNavigate();
  const [tools, setTools] = useState<McpTool[]>([]);

  const [caps, setCaps] = useState<Record<string, boolean>>({});
  const [connError, setConnError] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);

  const [usage, setUsage] = useState<Record<string, unknown> | null>(null);
  const [kind, setKind] = useState<BrowseKind>("audiences");
  const [search, setSearch] = useState("");
  const [listRows, setListRows] = useState<EnvelopeRow[]>([]);
  const [listing, setListing] = useState(false);

  const [lookupId, setLookupId] = useState("");
  const [detail, setDetail] = useState<{ kind: BrowseKind; row: EnvelopeRow; raw: unknown } | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const [refDataset, setRefDataset] = useState<string>("common");
  const [refCatalog, setRefCatalog] = useState<string>("dataset-types");
  const [refTree, setRefTree] = useState<{ roots: CatalogNode[]; synthesized: number }>({
    roots: [],
    synthesized: 0,
  });
  const [refRaw, setRefRaw] = useState<string>("");
  const [refBusy, setRefBusy] = useState(false);
  const [refError, setRefError] = useState<string | null>(null);

  const [audienceBody, setAudienceBody] = useState<string>(
    JSON.stringify({ name: "SonicSIM test audience", datasets: [] }, null, 2),
  );
  const [flowLog, setFlowLog] = useState<string[]>([]);
  const [flowBusy, setFlowBusy] = useState(false);

  const [keys, setKeys] = useState<string[]>([]);
  const [ingesting, setIngesting] = useState(false);
  const [exportingId, setExportingId] = useState<string | null>(null);


  const [rawTool, setRawTool] = useState<string>("");
  const [rawArgs, setRawArgs] = useState<string>("{}");
  const [formArgs, setFormArgs] = useState<Record<string, unknown>>({});
  const [jsonMode, setJsonMode] = useState(false);
  const [rawOut, setRawOut] = useState<string>("");
  const [rawResult, setRawResult] = useState<unknown>(null);
  const [listResult, setListResult] = useState<unknown>(null);
  const [rawBusy, setRawBusy] = useState(false);


  const [pending, setPending] = useState<PendingWrite | null>(null);

  const writeEnabled = caps["tools.write"] === true;
  const toolNames = useMemo(() => tools.map((t) => t.name).sort(), [tools]);
  const selectedToolDef = useMemo(() => tools.find((t) => t.name === rawTool), [tools, rawTool]);

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
      const args: Record<string, unknown> = { per_page: 50 };
      if (search.trim()) args.search = search.trim();
      const { result } = await callTool(BROWSE_TOOL[kind], args);
      setListRows(rows(result));
      setListResult(result);
    } catch (e) {
      toast.error(`Could not list ${kind}`, { description: (e as Error).message });
      setListRows([]);
      setListResult(null);
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

  /** Open an activation/audience/cohort straight from an id typed by the admin. */
  const lookupById = useCallback(async () => {
    const id = lookupId.trim();
    if (!id) return;
    await openDetail({ id });
  }, [lookupId, openDetail]);

  // Once connected, pull the existing console records for the active tab so
  // audiences/activations already created in Intuizi show up without a click.
  useEffect(() => {
    if (!tools.length) return;
    void browse();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tools.length, kind]);

  /**
   * Pull a reference catalog and nest it per the Intuizi taxonomy conventions
   * (CategoryID above TaxonomyID, IAB13-3 under IAB13, path-style labels).
   */
  const loadReference = useCallback(async () => {
    setRefBusy(true);
    setRefError(null);
    try {
      const { result } = await callTool("lookup_reference", {
        dataset: refDataset,
        catalog: refCatalog,
      });
      const arr = extractCatalogArray(unwrap(result) ?? result);
      const tree = buildCatalogTree(normalizeCatalogRows(arr));
      setRefTree({ roots: tree.roots, synthesized: tree.synthesizedParents });
      setRefRaw(asText(result).slice(0, 8000));
      if (!tree.roots.length) {
        setRefError("The catalog returned no rows — try another catalog for this dataset.");
      }
    } catch (e) {
      setRefTree({ roots: [], synthesized: 0 });
      setRefError((e as Error).message);
    } finally {
      setRefBusy(false);
    }
  }, [refDataset, refCatalog]);

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
      setRawResult(result);
      setRawOut("");
      await p.onDone?.(resourceId, result);
    } catch (e) {
      toast.error(`${p.tool} failed`, { description: (e as Error).message });
      log(`error: ${(e as Error).message}`);
    }
  }, [pending, log]);

  /** Validate + ingest a set of delivered S3 keys through the untouched pipeline. */
  const ingestKeys = useCallback(async (objectKeys: string[]) => {
    const { data: validated, error: vErr } = await supabase.functions.invoke("intuizi-ingest", {
      body: { action: "validate_keys", object_keys: objectKeys, expand_manifest: true },
    });
    if (vErr) throw vErr;
    const readable = ((validated as { keys?: Array<{ object_key: string; ok: boolean }> })?.keys ?? [])
      .filter((k) => k.ok);
    if (!readable.length) return { done: 0, total: 0 };
    let done = 0;
    for (const k of readable) {
      const { error } = await supabase.functions.invoke("intuizi-ingest", {
        body: { object_key: k.object_key },
      });
      if (!error) done += 1;
    }
    return { done, total: readable.length };
  }, []);

  const ingestDelivered = useCallback(async () => {
    if (!keys.length) return;
    setIngesting(true);
    try {
      const { done, total } = await ingestKeys(keys);
      if (!total) {
        toast.error("No delivered object was readable", {
          description: "Check the S3 credentials on Intuizi Console.",
        });
        return;
      }
      toast.success(`Ingested ${done}/${total} delivered object(s)`, {
        description: "Scoring runs through the existing ontology pipeline.",
      });
    } catch (e) {
      toast.error("Ingest handoff failed", { description: (e as Error).message });
    } finally {
      setIngesting(false);
    }
  }, [keys, ingestKeys]);

  /**
   * Export an activation to the main app: ingest whatever it delivered, then
   * deep-link into the semantic analysis page scoped to that activation.
   */
  const exportToApp = useCallback(async (activationId: string, knownKeys?: string[]) => {
    const id = String(activationId ?? "").trim();
    if (!id) {
      toast.error("No activation id on this row", {
        description: "Open it by id instead, or export from the activation detail view.",
      });
      return;
    }
    setExportingId(id);

    try {
      let objectKeys = knownKeys ?? [];
      if (!objectKeys.length) {
        const { result } = await callTool("get_activation", { id });
        objectKeys = deliveredKeys(result);
      }
      if (objectKeys.length) {
        const { done, total } = await ingestKeys(objectKeys);
        toast.success(`Exported activation ${id}`, {
          description: total
            ? `Ingested ${done}/${total} delivered object(s) — opening semantic analysis.`
            : "Delivered objects were not readable — opening semantic analysis anyway.",
        });
      } else {
        toast.message(`Activation ${id} has no delivery keys yet`, {
          description: "Opening semantic analysis for whatever is already ingested.",
        });
      }
      navigate(`/admin/semantic?activation=${encodeURIComponent(id)}`);
    } catch (e) {
      toast.error("Export failed", { description: (e as Error).message });
    } finally {
      setExportingId(null);
    }
  }, [ingestKeys, navigate]);

  /**
   * Add a listed audience to semantic analysis: resolve the activations that
   * delivered it to S3, ingest their objects through the existing pipeline,
   * then open semantic analysis scoped to the newest activation.
   */
  const exportAudienceToApp = useCallback(async (audienceId: string) => {
    const id = String(audienceId);
    setExportingId(`aud:${id}`);
    try {
      // 1) Keys sometimes ride along on the audience payload itself.
      const { result: audRes } = await callTool("get_audience", { id });
      let objectKeys = deliveredKeys(audRes);
      let activationId: string | null = null;

      // 2) Otherwise resolve the activations tied to this audience.
      if (!objectKeys.length) {
        let actRows: EnvelopeRow[] = [];
        try {
          const { result } = await callTool("list_activations", { audience_id: id, per_page: 50 });
          actRows = rows(result);
        } catch {
          /* filter fallback unsupported — fall through to unfiltered list */
        }
        if (!actRows.length) {
          const { result } = await callTool("list_activations", { per_page: 50 });
          actRows = rows(result).filter((r) => JSON.stringify(r).includes(`"${id}"`) || JSON.stringify(r).includes(`:${id}`));
        }
        for (const r of actRows.slice(0, 5)) {
          // Intuizi rows are not consistent about the id field name.
          const rec = r as Record<string, unknown>;
          const raw = rec.id ?? rec.activation_id ?? rec.activationId ?? rec.uuid;
          const actId = raw == null ? "" : String(raw).trim();
          if (!actId) continue;
          try {
            const { result } = await callTool("get_activation", { id: actId });
            const k = deliveredKeys(result);
            if (k.length) {
              objectKeys = objectKeys.concat(k);
              activationId = activationId ?? actId;
            }
          } catch {
            /* skip activations the API won't resolve */
          }
        }

      }

      if (objectKeys.length) {
        const { done, total } = await ingestKeys(Array.from(new Set(objectKeys)));
        toast.success(`Added audience ${id} to semantic analysis`, {
          description: total
            ? `Ingested ${done}/${total} delivered object(s) — opening analysis.`
            : "Delivered objects were not readable — opening analysis anyway.",
        });
      } else {
        toast.message(`Audience ${id} has no delivered objects yet`, {
          description: "Activate it to an S3 endpoint first, then add it again.",
        });
      }
      navigate(
        activationId
          ? `/admin/semantic?activation=${encodeURIComponent(activationId)}`
          : "/admin/semantic",
      );
    } catch (e) {
      toast.error("Add to semantic analysis failed", { description: (e as Error).message });
    } finally {
      setExportingId(null);
    }
  }, [ingestKeys, navigate]);




  const runRaw = useCallback(async () => {
    if (!rawTool) return;
    let args: Record<string, unknown> = {};
    if (jsonMode) {
      try {
        args = JSON.parse(rawArgs || "{}");
      } catch (e) {
        toast.error("Arguments must be JSON", { description: (e as Error).message });
        return;
      }
    } else {
      args = formArgs;
    }
    setRawBusy(true);
    try {
      const { result } = await callTool(rawTool, args);
      setRawResult(result);
      setRawOut("");
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
        setRawResult(null);
        setRawOut(`Error: ${msg}`);
      }
    } finally {
      setRawBusy(false);
    }
  }, [rawTool, rawArgs, formArgs, jsonMode]);

  return {
    tools, connError, connecting, usage, kind, setKind, search, setSearch,
    listRows, listing, lookupId, setLookupId, detail, detailLoading,
    refDataset, setRefDataset, refCatalog, setRefCatalog, refTree, setRefTree,
    refRaw, refBusy, refError, setRefError, audienceBody, setAudienceBody,
    flowLog, flowBusy, keys, ingesting, exportingId, rawTool, setRawTool,
    rawArgs, setRawArgs, formArgs, setFormArgs, jsonMode, setJsonMode,
    rawOut, setRawOut, rawResult, setRawResult, listResult, rawBusy, pending,
    setPending, writeEnabled, toolNames, selectedToolDef, connect, loadUsage,
    browse, openDetail, lookupById, loadReference, runEstimate,
    requestCreateAudience, requestActivation, confirmPending, ingestKeys,
    ingestDelivered, exportToApp, exportAudienceToApp, runRaw,
  };
};
