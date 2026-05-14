// Calls a tool on the Librosa MCP server (SSE transport).
// Body: { tool_name: string, arguments?: Record<string, unknown>, list_tools?: boolean }
// Performs the full SSE handshake: GET /sse → wait for endpoint event →
// POST initialize → POST initialized notification → POST tools/call → read result from SSE stream.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const INTEGRATION_ID = "mcp_librosa";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader.startsWith("Bearer ")) {
      return json({ success: false, error: "Missing auth" }, 401);
    }
    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData.user) {
      return json({ success: false, error: "Unauthorized" }, 401);
    }

    // Admin-only
    const admin = createClient(SUPABASE_URL, SERVICE_KEY);
    const { data: roleRow } = await admin
      .from("user_roles")
      .select("role")
      .eq("user_id", userData.user.id)
      .eq("role", "admin")
      .maybeSingle();
    if (!roleRow) return json({ success: false, error: "Admin only" }, 403);

    const body = await req.json().catch(() => ({}));
    const toolName: string | undefined = body?.tool_name;
    const args = (body?.arguments ?? {}) as Record<string, unknown>;
    const listOnly: boolean = body?.list_tools === true;
    if (!listOnly && (!toolName || typeof toolName !== "string")) {
      return json({ success: false, error: "tool_name required" }, 400);
    }

    // Load credentials
    const { data: credRows, error: credErr } = await admin
      .from("integration_credentials")
      .select("field_key, field_value")
      .eq("integration_id", INTEGRATION_ID);
    if (credErr) return json({ success: false, error: credErr.message }, 500);

    const creds: Record<string, string> = {};
    for (const r of credRows ?? []) creds[r.field_key] = r.field_value;
    const serverUrl = creds.MCP_SERVER_URL;
    if (!serverUrl) {
      return json(
        { success: false, error: "MCP_SERVER_URL not configured" },
        400,
      );
    }

    const baseHeaders: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    };
    if (creds.MCP_AUTH_TOKEN) {
      const scheme = (creds.MCP_AUTH_SCHEME || "Bearer").trim();
      baseHeaders["Authorization"] = `${scheme} ${creds.MCP_AUTH_TOKEN}`;
    }

    // 1) Open SSE stream
    // NOTE: do NOT put an AbortSignal.timeout on the SSE GET — it would kill
    // the whole stream mid-analysis. Per-read deadlines are enforced in pump().
    let sseResp: Response;
    try {
      sseResp = await fetch(serverUrl, {
        method: "GET",
        headers: { ...baseHeaders, Accept: "text/event-stream" },
        signal: AbortSignal.timeout(10_000),
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const friendly = msg.includes("dns error") || msg.includes("failed to lookup")
        ? "Librosa MCP tunnel is unreachable. Update the MCP_SERVER_URL or use Full analysis (visuals), which does not require MCP."
        : `Could not connect to Librosa MCP server: ${msg}`;
      return json({ success: false, error: friendly }, 502);
    }
    if (!sseResp.ok || !sseResp.body) {
      const t = await sseResp.text().catch(() => "");
      return json({
        success: false,
        error: `SSE GET ${sseResp.status}: ${t.slice(0, 200)}`,
      }, 502);
    }
    const reader = sseResp.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";

    // Helpers to read SSE events
    const pendingResults = new Map<number | string, unknown>();
    let endpointPath = "";

    let streamClosed = false;
    let streamError: string | null = null;
    const pump = async (deadlineMs: number): Promise<void> => {
      if (streamClosed) return;
      while (Date.now() < deadlineMs) {
        const remaining = Math.max(1, deadlineMs - Date.now());
        let r: { value?: Uint8Array; done?: boolean } | "timeout";
        try {
          r = await Promise.race([
            reader.read(),
            new Promise<"timeout">((res) =>
              setTimeout(() => res("timeout"), remaining)
            ),
          ]);
        } catch (e) {
          streamClosed = true;
          streamError = e instanceof Error ? e.message : String(e);
          return;
        }
        if (r === "timeout") return;
        const { value, done } = r;
        if (done) {
          streamClosed = true;
          return;
        }
        buf += decoder.decode(value, { stream: true });
        const normalized = buf.replace(/\r\n/g, "\n");
        const events = normalized.split("\n\n");
        buf = events.pop() ?? "";
        for (const ev of events) {
          const lines = ev.split("\n");
          const evName = lines.find((l) => l.startsWith("event:"))?.slice(6)
            .trim();
          const dataStr = lines
            .filter((l) => l.startsWith("data:"))
            .map((l) => l.slice(5).trim())
            .join("\n");
          if (evName === "endpoint" && dataStr && !endpointPath) {
            endpointPath = dataStr;
            return; // got endpoint
          }
          // SSE's default event type is "message" when the server omits an
          // explicit `event:` line. mcp-proxy may emit JSON-RPC responses this
          // way, so treat both `event: message` and bare `data:` as results.
          if ((!evName || evName === "message") && dataStr) {
            try {
              const obj = JSON.parse(dataStr);
              if (obj && typeof obj === "object" && "id" in obj) {
                pendingResults.set(obj.id, obj);
              }
            } catch { /* skip */ }
          }
        }
      }
    };

    // Wait for endpoint
    await pump(Date.now() + 10_000);
    if (!endpointPath) {
      try {
        await reader.cancel();
      } catch { /* noop */ }
      return json(
        { success: false, error: "No SSE endpoint event received" },
        502,
      );
    }
    const messagesUrl = new URL(endpointPath, serverUrl).toString();

    const post = async (payload: unknown) => {
      try {
        return await fetch(messagesUrl, {
          method: "POST",
          headers: baseHeaders,
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(20_000),
        });
      } catch (e) {
        throw new Error(`Librosa MCP request failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    };

    const waitFor = async (id: number | string, timeoutMs: number) => {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        if (pendingResults.has(id)) return pendingResults.get(id);
        await pump(Math.min(deadline, Date.now() + 2000));
      }
      return null;
    };

    // 2) initialize
    const initResp = await post({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "lovable-librosa-mcp-caller", version: "1.0.0" },
      },
    });
    if (!initResp.ok) {
      try {
        await reader.cancel();
      } catch { /* noop */ }
      const t = await initResp.text().catch(() => "");
      return json({
        success: false,
        error: `initialize ${initResp.status}: ${t.slice(0, 200)}`,
      }, 502);
    }
    const initResult = await waitFor(1, 10_000);
    if (!initResult) {
      try {
        await reader.cancel();
      } catch { /* noop */ }
      return json({
        success: false,
        error: "MCP initialize did not respond within 10s",
      }, 504);
    }

    // 3) initialized notification
    await post({
      jsonrpc: "2.0",
      method: "notifications/initialized",
      params: {},
    });

    // 4) tools/call (or tools/list)
    const callId = 2;
    const rpc = listOnly
      ? { jsonrpc: "2.0", id: callId, method: "tools/list", params: {} }
      : {
        jsonrpc: "2.0",
        id: callId,
        method: "tools/call",
        params: { name: toolName, arguments: args },
      };
    const callResp = await post(rpc);
    if (!callResp.ok) {
      try {
        await reader.cancel();
      } catch { /* noop */ }
      const t = await callResp.text().catch(() => "");
      return json({
        success: false,
        error: `tools/call ${callResp.status}: ${t.slice(0, 300)}`,
      }, 502);
    }

    const toolTimeoutMs = toolName === "download_from_url"
      ? 75_000
      : toolName === "load"
      ? 60_000
      : 120_000;
    const result = await waitFor(callId, toolTimeoutMs);
    try {
      await reader.cancel();
    } catch { /* noop */ }

    if (!result) {
      const base = `MCP tool '${toolName ?? "tools/list"}' did not respond within ${
        Math.round(toolTimeoutMs / 1000)
      }s`;
      const detail = streamError
        ? `${base} (SSE stream closed: ${streamError})`
        : streamClosed
        ? `${base} (SSE stream closed by upstream before result)`
        : base;
      return json({ success: false, error: detail }, 504);
    }
    const r = result as { result?: unknown; error?: { message?: string } };
    if (r.error) {
      return json(
        { success: false, error: r.error.message ?? "MCP error" },
        502,
      );
    }
    return json({ success: true, result: r.result });
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
