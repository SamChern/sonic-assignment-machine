// Admin-guarded bridge to the Intuizi MCP server (stateless Streamable HTTP at
// https://console.intuizi.com/api/v2/mcp). Wraps `tools/list`, `tools/call`,
// `resources/list` and `resources/read`, enforces a read/write allow-list tied
// to the integration's capability toggles, honours 429 `Retry-After`, and
// records every call in public.intuizi_mcp_runs.
//
// Body:
//   { action: "list_tools" }
//   { action: "list_resources" } | { action: "read_resource", uri }
//   { action: "call", tool_name, arguments?, confirm?, idempotency_key? }
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { requireAdmin, AuthzError } from "../_shared/admin.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const INTEGRATION_ID = "mcp_intuizi";
const DEFAULT_SERVER_URL = "https://console.intuizi.com/api/v2/mcp";

/** Read-only tools — always callable when tools.read is enabled. */
const READ_TOOLS = new Set([
  "lookup_reference",
  "list_audiences",
  "get_audience",
  "get_audience_estimate",
  "estimate_audience_size",
  "list_activations",
  "get_activation",
  "list_cohorts",
  "get_cohort",
  "preview_cohort_file",
  "browse_poi_data",
  "list_projects",
  "get_usage",
]);

/** Mutating tools — require the tools.write capability AND confirm: true. */
const WRITE_TOOLS = new Set([
  "create_audience",
  "create_lookalike_audience",
  "cancel_lookalike",
  "create_activation",
  "create_cohort",
  "create_project",
  "create_poi_category",
  "create_poi_brand",
  "create_poi_submission",
  "create_upload",
]);

/** Destructive tools — write capability + confirm, called out separately. */
const DESTRUCTIVE_TOOLS = new Set([
  "delete_audience",
  "delete_activation",
  "delete_cohort",
  "delete_poi_submission",
]);

interface McpCreds {
  url: string;
  headers: Record<string, string>;
  caps: Record<string, boolean>;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(SUPABASE_URL, SERVICE_KEY);

  try {
    const authz = await requireAdmin(req, admin).catch((e) => e as AuthzError);
    if (authz instanceof AuthzError) {
      return json({ success: false, error: authz.message }, authz.status);
    }

    const body = await req.json().catch(() => ({} as Record<string, unknown>));
    const action = String(body?.action ?? "call");

    const creds = await loadCreds(admin);
    if (!creds) {
      return json(
        {
          success: false,
          error:
            "Intuizi MCP is not configured — paste an MCP token on Admin → Integrations → MCP Servers.",
        },
        400,
      );
    }

    if (action === "list_tools") {
      const r = await rpc(creds, "tools/list", {});
      if (!r.ok) return json({ success: false, error: r.error }, r.status);
      const tools = (r.result as { tools?: Array<{ name: string }> })?.tools ?? [];
      return json({
        success: true,
        tools,
        capabilities: creds.caps,
        classification: {
          read: tools.filter((t) => READ_TOOLS.has(t.name)).map((t) => t.name),
          write: tools.filter((t) => WRITE_TOOLS.has(t.name)).map((t) => t.name),
          destructive: tools
            .filter((t) => DESTRUCTIVE_TOOLS.has(t.name))
            .map((t) => t.name),
        },
      });
    }

    if (action === "list_resources") {
      if (creds.caps["resources.read"] === false) {
        return json({ success: false, error: "resources.read is disabled for this integration" }, 403);
      }
      const r = await rpc(creds, "resources/list", {});
      return r.ok
        ? json({ success: true, result: r.result })
        : json({ success: false, error: r.error }, r.status);
    }

    if (action === "read_resource") {
      const uri = String(body?.uri ?? "");
      if (!uri) return json({ success: false, error: "uri is required" }, 400);
      if (creds.caps["resources.read"] === false) {
        return json({ success: false, error: "resources.read is disabled for this integration" }, 403);
      }
      const r = await rpc(creds, "resources/read", { uri });
      return r.ok
        ? json({ success: true, result: r.result })
        : json({ success: false, error: r.error }, r.status);
    }

    if (action !== "call") {
      return json({ success: false, error: `Unknown action: ${action}` }, 400);
    }

    // ---- tools/call ---------------------------------------------------------
    const toolName = String(body?.tool_name ?? "");
    const args = (body?.arguments ?? {}) as Record<string, unknown>;
    const confirm = body?.confirm === true;
    const idempotencyKey =
      typeof body?.idempotency_key === "string" ? body.idempotency_key : undefined;

    if (!toolName) return json({ success: false, error: "tool_name is required" }, 400);

    const isWrite = WRITE_TOOLS.has(toolName) || DESTRUCTIVE_TOOLS.has(toolName);
    const isKnown = isWrite || READ_TOOLS.has(toolName);
    if (!isKnown) {
      return json(
        { success: false, error: `Tool "${toolName}" is not in the Intuizi allow-list.` },
        400,
      );
    }
    if (!isWrite && creds.caps["tools.read"] === false) {
      return json({ success: false, error: "tools.read is disabled for this integration" }, 403);
    }
    if (isWrite) {
      if (creds.caps["tools.write"] !== true) {
        return json(
          {
            success: false,
            error:
              "Write tools are disabled — enable the 'Create & modify Intuizi resources' capability first.",
          },
          403,
        );
      }
      if (!confirm) {
        return json(
          { success: false, error: "This tool mutates your Intuizi account — confirm required." },
          428,
        );
      }
    }

    const callArgs = idempotencyKey && isWrite
      ? { ...args, idempotency_key: idempotencyKey }
      : args;

    const started = Date.now();
    const r = await rpc(creds, "tools/call", { name: toolName, arguments: callArgs });

    const resourceId = r.ok ? extractResourceId(r.result) : null;
    await admin.from("intuizi_mcp_runs").insert({
      tool_name: toolName,
      arguments: sanitizeArgs(callArgs),
      idempotency_key: idempotencyKey ?? null,
      resource_type: resourceTypeOf(toolName),
      resource_id: resourceId,
      status: r.ok ? "success" : "failed",
      error: r.ok ? null : String(r.error).slice(0, 2000),
      run_by: authz.userId,
    });

    if (!r.ok) return json({ success: false, error: r.error }, r.status);
    return json({
      success: true,
      result: r.result,
      resource_id: resourceId,
      latency_ms: Date.now() - started,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return json({ success: false, error: msg }, 500);
  }
});

// ---- helpers ---------------------------------------------------------------

async function loadCreds(
  admin: ReturnType<typeof createClient>,
): Promise<McpCreds | null> {
  const { data, error } = await admin
    .from("integration_credentials")
    .select("field_key, field_value")
    .eq("integration_id", INTEGRATION_ID);
  if (error) throw new Error(error.message);

  const map: Record<string, string> = {};
  for (const row of data ?? []) map[row.field_key] = row.field_value;

  const token = map.MCP_AUTH_TOKEN ?? Deno.env.get("INTUIZI_MCP_TOKEN") ?? "";
  if (!token) return null;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    // MCP Streamable HTTP requires both media types.
    "Accept": "application/json, text/event-stream",
    "Authorization": `${(map.MCP_AUTH_SCHEME || "Bearer").trim()} ${token}`,
  };
  if (map.MCP_HEADERS_JSON) {
    try {
      const extra = JSON.parse(map.MCP_HEADERS_JSON);
      if (extra && typeof extra === "object") {
        for (const [k, v] of Object.entries(extra)) {
          if (typeof v === "string") headers[k] = v;
        }
      }
    } catch { /* ignore malformed extra headers */ }
  }

  const caps: Record<string, boolean> = {};
  for (const [k, v] of Object.entries(map)) {
    if (!k.startsWith("MCP_CAP_")) continue;
    const key = k.slice(8).toLowerCase().replace(/_/g, ".");
    caps[key] = v === "true";
  }
  // Reads default on when the toggle was never saved.
  if (caps["tools.read"] === undefined) caps["tools.read"] = true;

  return { url: map.MCP_SERVER_URL || DEFAULT_SERVER_URL, headers, caps };
}

interface RpcOutcome {
  ok: boolean;
  result?: unknown;
  error?: string;
  status: number;
}

/** One JSON-RPC round trip with bounded 429 backoff honouring Retry-After. */
async function rpc(
  creds: McpCreds,
  method: string,
  params: Record<string, unknown>,
  attempt = 0,
): Promise<RpcOutcome> {
  const payload = { jsonrpc: "2.0", id: Date.now(), method, params };

  const res = await fetch(creds.url, {
    method: "POST",
    headers: creds.headers,
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(60_000),
  });

  const text = await res.text();

  if (res.status === 429 && attempt < 2) {
    const retryAfter = Number(res.headers.get("Retry-After") ?? 0);
    const waitMs = Math.min(Math.max(retryAfter, 1) * 1000, 10_000);
    await new Promise((r) => setTimeout(r, waitMs));
    return rpc(creds, method, params, attempt + 1);
  }

  if (!res.ok) {
    // Surface Intuizi's error envelope verbatim instead of a generic 500.
    return { ok: false, status: res.status, error: `HTTP ${res.status}: ${text.slice(0, 1500)}` };
  }

  const parsed = parseRpc(text, res.headers.get("content-type") ?? "");
  if (!parsed) {
    return { ok: false, status: 502, error: `Unparseable response: ${text.slice(0, 400)}` };
  }
  if (parsed.error) {
    return { ok: false, status: 502, error: parsed.error.message ?? JSON.stringify(parsed.error) };
  }
  return { ok: true, status: 200, result: parsed.result };
}

function parseRpc(
  text: string,
  contentType: string,
): { result?: unknown; error?: { message?: string } } | null {
  if (contentType.includes("text/event-stream")) {
    const line = text.split("\n").find((l) => l.startsWith("data:"));
    if (!line) return null;
    try { return JSON.parse(line.slice(5).trim()); } catch { return null; }
  }
  try { return JSON.parse(text); } catch { return null; }
}

function resourceTypeOf(tool: string): string | null {
  if (tool.includes("audience")) return "audience";
  if (tool.includes("activation")) return "activation";
  if (tool.includes("cohort")) return "cohort";
  if (tool.includes("project")) return "project";
  if (tool.includes("poi")) return "poi";
  if (tool.includes("upload")) return "upload";
  return null;
}

/** Pull an id out of the API envelope (`data[0].id` or `data.id`). */
function extractResourceId(result: unknown): string | null {
  const texts: string[] = [];
  const content = (result as { content?: Array<{ type?: string; text?: string }> })?.content;
  for (const c of content ?? []) if (typeof c.text === "string") texts.push(c.text);
  const structured = (result as { structuredContent?: unknown })?.structuredContent;
  const candidates: unknown[] = [structured];
  for (const t of texts) {
    try { candidates.push(JSON.parse(t)); } catch { /* not JSON */ }
  }
  for (const c of candidates) {
    const data = (c as { data?: unknown })?.data;
    const first = Array.isArray(data) ? data[0] : data;
    const id = (first as { id?: unknown })?.id;
    if (typeof id === "string" || typeof id === "number") return String(id);
  }
  return null;
}

/** Never persist anything credential-shaped in the run ledger. */
function sanitizeArgs(args: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(args)) {
    if (/token|secret|password|key$/i.test(k) && k !== "idempotency_key") {
      out[k] = "[redacted]";
    } else {
      out[k] = v;
    }
  }
  return out;
}

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
