// Tester for the Librosa REST integration. Admin-only. Performs a GET /health
// against the configured base URL with the stored Bearer token, records the
// outcome in integration_test_history, and returns latency.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { requireAdmin, AuthzError } from "../_shared/admin.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const INTEGRATION_ID = "librosa_rest";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const startedAt = Date.now();

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // Uniform authorization: admin role or internal service-role invocation.
    const admin = createClient(SUPABASE_URL, SERVICE_KEY);
    const authz = await requireAdmin(req, admin).catch((e) => e as AuthzError);
    if (authz instanceof AuthzError) {
      return json({ success: false, error: authz.message }, authz.status);
    }

    // Load credentials
    const { data: credRows, error: credErr } = await admin
      .from("integration_credentials")
      .select("field_key, field_value")
      .eq("integration_id", INTEGRATION_ID);
    if (credErr) {
      return await record(admin, authz.userId, false, startedAt, credErr.message);
    }

    const creds: Record<string, string> = {};
    for (const r of credRows ?? []) creds[r.field_key] = r.field_value;

    const baseUrl = (creds.LIBROSA_REST_URL || "").replace(/\/+$/, "");
    const token = creds.LIBROSA_REST_TOKEN;

    if (!baseUrl) {
      return await record(admin, authz.userId, false, startedAt, "LIBROSA_REST_URL not configured");
    }
    if (!token) {
      return await record(admin, authz.userId, false, startedAt, "LIBROSA_REST_TOKEN not configured");
    }

    const healthUrl = `${baseUrl}/health`;

    let resp: Response;
    let text = "";
    try {
      resp = await fetch(healthUrl, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
        },
        signal: AbortSignal.timeout(10_000),
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

    let parsed: { ok?: boolean; service?: string; version?: string } | null = null;
    try { parsed = JSON.parse(text); } catch { /* noop */ }

    if (!parsed?.ok) {
      return await record(
        admin, authz.userId, false, startedAt,
        `Unexpected /health body: ${text.slice(0, 200)}`,
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
