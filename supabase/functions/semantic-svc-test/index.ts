// Tester for the Semantic Service (EC2 embeddings/CLAP) integration. Admin-only.
// GETs /healthz on the configured base URL with the stored Bearer token and
// records the outcome in integration_test_history.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { requireAdmin, AuthzError } from "../_shared/admin.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const INTEGRATION_ID = "semantic_svc";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const startedAt = Date.now();

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(SUPABASE_URL, SERVICE_KEY);

    const authz = await requireAdmin(req, admin).catch((e) => e as AuthzError);
    if (authz instanceof AuthzError) {
      return json({ success: false, error: authz.message }, authz.status);
    }

    const { data: credRows, error: credErr } = await admin
      .from("integration_credentials")
      .select("field_key, field_value")
      .eq("integration_id", INTEGRATION_ID);
    if (credErr) {
      return await record(admin, authz.userId, false, startedAt, credErr.message);
    }

    const creds: Record<string, string> = {};
    for (const r of credRows ?? []) creds[r.field_key] = r.field_value;

    const baseUrl = (creds.SEMANTIC_SVC_URL || "").replace(/\/+$/, "");
    const token = creds.SEMANTIC_SVC_TOKEN;

    if (!baseUrl) {
      return await record(admin, authz.userId, false, startedAt, "SEMANTIC_SVC_URL not configured");
    }
    if (!token) {
      return await record(admin, authz.userId, false, startedAt, "SEMANTIC_SVC_TOKEN not configured");
    }

    let resp: Response;
    let text = "";
    try {
      resp = await fetch(`${baseUrl}/healthz`, {
        method: "GET",
        headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
        signal: AbortSignal.timeout(15_000),
      });
      text = await resp.text();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Network error";
      return await record(admin, authz.userId, false, startedAt, `Fetch failed: ${msg}`);
    }

    if (!resp.ok) {
      return await record(
        admin, authz.userId, false, startedAt,
        `HTTP ${resp.status}: ${text.slice(0, 300)}`,
      );
    }

    let parsed: { ok?: boolean; service?: string; models?: unknown } | null = null;
    try { parsed = JSON.parse(text); } catch { /* noop */ }

    if (!parsed?.ok) {
      return await record(
        admin, authz.userId, false, startedAt,
        `Unexpected /healthz body: ${text.slice(0, 200)}`,
      );
    }

    return await record(admin, authz.userId, true, startedAt, null, parsed);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown";
    return json({ success: false, error: msg }, 500);
  }
});

async function record(
  admin: ReturnType<typeof createClient> | any,
  userId: string,
  success: boolean,
  startedAt: number,
  errorMessage: string | null,
  responseSample: unknown = null,
) {
  const latency = Date.now() - startedAt;
  await admin.from("integration_test_history").insert({
    integration_id: INTEGRATION_ID,
    success,
    latency_ms: latency,
    error_message: errorMessage,
    response_sample: responseSample as never,
    tested_by: userId,
  });
  return json({
    success,
    integration_id: INTEGRATION_ID,
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
