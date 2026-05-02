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

    // Detect transport: URLs ending in /sse use the legacy SSE transport
    // (two endpoints: GET /sse for the stream, POST /messages/?session_id=...).
    // Everything else is treated as Streamable HTTP (single endpoint, both GET+POST).
    const isSseTransport = /\/sse\/?$/i.test(new URL(serverUrl).pathname);

    let resp: Response;
    let text = "";
    let contentType = "";

    try {
      if (isSseTransport) {
        // Step 1: GET /sse to open the stream and read the endpoint event.
        const sseController = new AbortController();
        const sseConnectTimer = setTimeout(() => sseController.abort(), 10_000);
        const sseResp = await fetch(serverUrl, {
          method: "GET",
          headers: { ...headers, Accept: "text/event-stream" },
          signal: sseController.signal,
        });
        clearTimeout(sseConnectTimer);
        if (!sseResp.ok || !sseResp.body) {
          const errText = await sseResp.text().catch(() => "");
          return await record(
            admin, integrationId, userData.user.id, false, startedAt,
            `SSE GET failed: HTTP ${sseResp.status}: ${errText.slice(0, 200)}`,
          );
        }

        // Read the SSE stream until we see `event: endpoint` + `data: <path>`.
        const reader = sseResp.body.getReader();
        const decoder = new TextDecoder();
        let buf = "";
        let endpointPath = "";
        const sseDeadline = Date.now() + 10_000;
        while (Date.now() < sseDeadline && !endpointPath) {
          const remainingMs = Math.max(1, sseDeadline - Date.now());
          const readResult = await Promise.race([
            reader.read(),
            new Promise<"timeout">((resolve) => setTimeout(() => resolve("timeout"), remainingMs)),
          ]);
          if (readResult === "timeout") break;
          const { value, done } = readResult;
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          // Parse complete events (separated by \n\n)
          const normalized = buf.replace(/\r\n/g, "\n");
          const events = normalized.split("\n\n");
          buf = events.pop() ?? "";
          for (const ev of events) {
            const lines = ev.split("\n");
            const eventLine = lines.find((l) => l.startsWith("event:"))?.slice(6).trim();
            const dataLine = lines.find((l) => l.startsWith("data:"))?.slice(5).trim();
            if (eventLine === "endpoint" && dataLine) {
              endpointPath = dataLine;
              break;
            }
          }
        }
        if (!endpointPath) {
          try { await reader.cancel(); } catch { /* noop */ }
          return await record(
            admin, integrationId, userData.user.id, false, startedAt,
            "SSE stream opened but no `event: endpoint` received within 10s",
          );
        }

        // Resolve relative path against the SSE URL's origin.
        const messagesUrl = new URL(endpointPath, serverUrl).toString();

        // Step 2: POST initialize to /messages/?session_id=...
        // Per SSE spec the response body is just `Accepted`; the actual JSON-RPC
        // result would come back over the (now-closed) SSE stream. For a connectivity
        // test, a 2xx Accepted is sufficient proof the handshake works.
        resp = await fetch(messagesUrl, {
          method: "POST",
          headers,
          body: JSON.stringify(initPayload),
          signal: AbortSignal.timeout(10_000),
        });
        text = await resp.text();
        // Now safe to close the SSE stream — POST has been accepted.
        try { await reader.cancel(); } catch { /* noop */ }
        contentType = resp.headers.get("content-type") ?? "";
      } else {
        // Streamable HTTP: single endpoint, POST initialize directly.
        resp = await fetch(serverUrl, {
          method: "POST",
          headers,
          body: JSON.stringify(initPayload),
          signal: AbortSignal.timeout(15_000),
        });
        text = await resp.text();
        contentType = resp.headers.get("content-type") ?? "";
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Network error";
      return await record(admin, integrationId, userData.user.id, false, startedAt, `Fetch failed: ${msg}`);
    }

    if (!resp.ok) {
      return await record(
        admin, integrationId, userData.user.id, false, startedAt,
        `HTTP ${resp.status}: ${text.slice(0, 300)}`,
      );
    }

    if (isSseTransport) {
      // 2xx on the messages endpoint is success. Body is typically just "Accepted".
      return await record(
        admin, integrationId, userData.user.id, true, startedAt, null,
        { transport: "sse", status: resp.status, body: text.slice(0, 200) },
      );
    }

    // Streamable HTTP: parse JSON or SSE-framed JSON.
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
  admin: ReturnType<typeof createClient> | any,
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
