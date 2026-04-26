// Generic MCP server tester: performs a JSON-RPC `initialize` handshake against
// a configured MCP integration and records the result in integration_test_history.
// Works for any integration whose credentials include MCP_SERVER_URL.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// Map test endpoint name (function URL last segment) → integration_id.
// The admin UI invokes this function once per integration, so we need to know
// which integration the caller is testing. Caller passes ?integration_id= in the
// URL or { integration_id } in the body.
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

  const startedAt = Date.now();
  let integrationId = "";

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader.startsWith("Bearer ")) {
      return json({ success: false, error: "Missing auth" }, 401);
    }

    // Verify caller is admin
    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData.user) {
      return json({ success: false, error: "Unauthorized" }, 401);
    }

    const admin = createClient(SUPABASE_URL, SERVICE_KEY);
    const { data: roleRow } = await admin
      .from("user_roles")
      .select("role")
      .eq("user_id", userData.user.id)
      .eq("role", "admin")
      .maybeSingle();
    if (!roleRow) return json({ success: false, error: "Admin only" }, 403);

    // Resolve integration_id (body or query)
    const url = new URL(req.url);
    const body = req.method === "POST"
      ? await req.json().catch(() => ({}))
      : {};
    integrationId = body?.integration_id ?? url.searchParams.get("integration_id") ?? "";
    if (!KNOWN_MCP_INTEGRATIONS.has(integrationId)) {
      return json(
        { success: false, error: `Unknown or non-MCP integration: ${integrationId || "<empty>"}` },
        400,
      );
    }

    // Load credentials for this integration
    const { data: credRows, error: credErr } = await admin
      .from("integration_credentials")
      .select("field_key, field_value")
      .eq("integration_id", integrationId);
    if (credErr) {
      return await record(admin, integrationId, userData.user.id, false, startedAt, credErr.message);
    }

    const creds: Record<string, string> = {};
    for (const r of credRows ?? []) creds[r.field_key] = r.field_value;

    const serverUrl = creds.MCP_SERVER_URL;
    if (!serverUrl) {
      return await record(admin, integrationId, userData.user.id, false, startedAt, "MCP_SERVER_URL not configured");
    }

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      // Required by MCP Streamable HTTP spec — without this servers return 406.
      "Accept": "application/json, text/event-stream",
    };
    if (creds.MCP_AUTH_TOKEN) {
      const scheme = (creds.MCP_AUTH_SCHEME || "Bearer").trim();
      headers["Authorization"] = `${scheme} ${creds.MCP_AUTH_TOKEN}`;
    }
    // Optional extra headers
    if (creds.MCP_HEADERS_JSON) {
      try {
        const extra = JSON.parse(creds.MCP_HEADERS_JSON);
        if (extra && typeof extra === "object") {
          for (const [k, v] of Object.entries(extra)) {
            if (typeof v === "string") headers[k] = v;
          }
        }
      } catch {
        // Ignore malformed JSON — surfaced as part of the test if it matters.
      }
    }

    // JSON-RPC initialize per MCP spec
    const initPayload = {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "lovable-mcp-tester", version: "1.0.0" },
      },
    };

    let resp: Response;
    try {
      resp = await fetch(serverUrl, {
        method: "POST",
        headers,
        body: JSON.stringify(initPayload),
        // 15s timeout via AbortController
        signal: AbortSignal.timeout(15_000),
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Network error";
      return await record(admin, integrationId, userData.user.id, false, startedAt, `Fetch failed: ${msg}`);
    }

    const text = await resp.text();
    const contentType = resp.headers.get("content-type") ?? "";

    if (!resp.ok) {
      return await record(
        admin, integrationId, userData.user.id, false, startedAt,
        `HTTP ${resp.status}: ${text.slice(0, 300)}`,
      );
    }

    // Parse — could be JSON or SSE-style "data: {...}\n\n"
    let parsed: unknown = null;
    if (contentType.includes("text/event-stream")) {
      const dataLine = text.split("\n").find((l) => l.startsWith("data:"));
      if (dataLine) {
        try { parsed = JSON.parse(dataLine.slice(5).trim()); } catch { /* noop */ }
      }
    } else {
      try { parsed = JSON.parse(text); } catch { /* noop */ }
    }

    const r = parsed as { result?: { serverInfo?: unknown; protocolVersion?: string }; error?: { message?: string } } | null;
    if (r?.error) {
      return await record(
        admin, integrationId, userData.user.id, false, startedAt,
        `JSON-RPC error: ${r.error.message ?? "unknown"}`,
        parsed,
      );
    }
    if (!r?.result) {
      return await record(
        admin, integrationId, userData.user.id, false, startedAt,
        `Unexpected response shape: ${text.slice(0, 200)}`,
      );
    }

    return await record(admin, integrationId, userData.user.id, true, startedAt, null, parsed);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown";
    return json({ success: false, error: msg, integration_id: integrationId }, 500);
  }
});

async function record(
  admin: ReturnType<typeof createClient>,
  integrationId: string,
  userId: string,
  success: boolean,
  startedAt: number,
  errorMessage: string | null,
  responseSample: unknown = null,
) {
  const latency = Date.now() - startedAt;
  await admin.from("integration_test_history").insert({
    integration_id: integrationId,
    success,
    latency_ms: latency,
    error_message: errorMessage,
    response_sample: responseSample as never,
    tested_by: userId,
  });
  return json({
    success,
    integration_id: integrationId,
    latency_ms: latency,
    error: errorMessage ?? undefined,
  });
}

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
