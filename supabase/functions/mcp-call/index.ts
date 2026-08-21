// Generic MCP runtime invoker: calls `tools/call` against a configured MCP
// integration. Authenticated users only (verify_jwt = true). Designed to be
// called from other edge functions or from the frontend for diagnostic UIs.
//
// Body: { integration_id: string, tool_name: string, arguments?: Record<string, unknown> }
// Response: { success: boolean, result?: unknown, error?: string }
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { requireAdmin, AuthzError } from "../_shared/admin.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const KNOWN_MCP_INTEGRATIONS = new Set([
  "mcp_generic",
  "mcp_notion",
  "mcp_linear",
  "mcp_librosa",
]);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // Diagnostic/maintenance endpoint: admin role or internal service-role only.
    const admin = createClient(SUPABASE_URL, SERVICE_KEY);
    const authz = await requireAdmin(req, admin).catch((e) => e as AuthzError);
    if (authz instanceof AuthzError) {
      return json({ success: false, error: authz.message }, authz.status);
    }

    const body = await req.json().catch(() => null);
    const integrationId: string | undefined = body?.integration_id;
    const toolName: string | undefined = body?.tool_name;
    const listOnly: boolean = body?.list_tools === true;
    const args = (body?.arguments ?? {}) as Record<string, unknown>;

    if (!integrationId || !KNOWN_MCP_INTEGRATIONS.has(integrationId)) {
      return json({ success: false, error: "Unknown or non-MCP integration" }, 400);
    }
    if (!listOnly && (!toolName || typeof toolName !== "string")) {
      return json({ success: false, error: "tool_name is required" }, 400);
    }

    const { data: credRows, error: credErr } = await admin
      .from("integration_credentials")
      .select("field_key, field_value")
      .eq("integration_id", integrationId);
    if (credErr) return json({ success: false, error: credErr.message }, 500);

    const creds: Record<string, string> = {};
    for (const r of credRows ?? []) creds[r.field_key] = r.field_value;

    const serverUrl = creds.MCP_SERVER_URL;
    if (!serverUrl) {
      return json({ success: false, error: "MCP_SERVER_URL not configured" }, 400);
    }

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "Accept": "application/json, text/event-stream",
    };
    if (creds.MCP_AUTH_TOKEN) {
      const scheme = (creds.MCP_AUTH_SCHEME || "Bearer").trim();
      headers["Authorization"] = `${scheme} ${creds.MCP_AUTH_TOKEN}`;
    }
    if (creds.MCP_HEADERS_JSON) {
      try {
        const extra = JSON.parse(creds.MCP_HEADERS_JSON);
        if (extra && typeof extra === "object") {
          for (const [k, v] of Object.entries(extra)) {
            if (typeof v === "string") headers[k] = v;
          }
        }
      } catch { /* ignore */ }
    }

    const rpc = listOnly
      ? { jsonrpc: "2.0", id: Date.now(), method: "tools/list", params: {} }
      : {
          jsonrpc: "2.0",
          id: Date.now(),
          method: "tools/call",
          params: { name: toolName, arguments: args },
        };

    const resp = await fetch(serverUrl, {
      method: "POST",
      headers,
      body: JSON.stringify(rpc),
      signal: AbortSignal.timeout(60_000),
    });

    const text = await resp.text();
    const contentType = resp.headers.get("content-type") ?? "";

    if (!resp.ok) {
      return json(
        { success: false, error: `HTTP ${resp.status}: ${text.slice(0, 500)}` },
        502,
      );
    }

    let parsed: { result?: unknown; error?: { message?: string } } | null = null;
    if (contentType.includes("text/event-stream")) {
      const dataLine = text.split("\n").find((l) => l.startsWith("data:"));
      if (dataLine) {
        try { parsed = JSON.parse(dataLine.slice(5).trim()); } catch { /* noop */ }
      }
    } else {
      try { parsed = JSON.parse(text); } catch { /* noop */ }
    }

    if (!parsed) {
      return json({ success: false, error: `Unparseable response: ${text.slice(0, 300)}` }, 502);
    }
    if (parsed.error) {
      return json({ success: false, error: parsed.error.message ?? "MCP error" }, 502);
    }

    return json({ success: true, result: parsed.result });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown";
    return json({ success: false, error: msg }, 500);
  }
});

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
