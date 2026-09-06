// Returns which fields are configured for each integration (boolean only).
// Never returns actual credential values.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { requireAdmin, AuthzError } from "../_shared/admin.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // Uniform authorization: admin role or internal service-role invocation.
    const admin = createClient(SUPABASE_URL, SERVICE_KEY);
    const authz = await requireAdmin(req, admin).catch((e) => e as AuthzError);
    if (authz instanceof AuthzError) {
      return json({ success: false, error: authz.message }, authz.status);
    }

    const { data: creds, error } = await admin
      .from("integration_credentials")
      .select("integration_id, field_key, updated_at");
    if (error) return json({ error: error.message }, 500);

    const { data: history } = await admin
      .from("integration_test_history")
      .select("integration_id, success, latency_ms, error_message, tested_at")
      .order("tested_at", { ascending: false });

    // Latest test per integration
    const lastTest: Record<string, unknown> = {};
    for (const row of history ?? []) {
      if (!lastTest[row.integration_id]) lastTest[row.integration_id] = row;
    }

    const fieldsByIntegration: Record<string, { fields: string[]; updated_at: string | null; env_fields?: string[] }> = {};
    for (const c of creds ?? []) {
      if (!fieldsByIntegration[c.integration_id]) {
        fieldsByIntegration[c.integration_id] = { fields: [], updated_at: null };
      }
      fieldsByIntegration[c.integration_id].fields.push(c.field_key);
      const cur = fieldsByIntegration[c.integration_id].updated_at;
      if (!cur || new Date(c.updated_at) > new Date(cur)) {
        fieldsByIntegration[c.integration_id].updated_at = c.updated_at;
      }
    }

    // Credentials can also live as platform secrets (env vars) with no row in
    // integration_credentials — the runtime functions read those directly, so a
    // setup page that ignores them wrongly reports "not configured".
    const ENV_BACKED: Record<string, string[]> = {
      spotify: ["SPOTIFY_CLIENT_ID", "SPOTIFY_CLIENT_SECRET"],
      apple_music: ["APPLE_TEAM_ID", "APPLE_KEY_ID", "APPLE_PRIVATE_KEY"],
      librosa_rest: ["LIBROSA_REST_URL", "LIBROSA_REST_TOKEN"],
      semantic_svc: ["SEMANTIC_SVC_URL", "SEMANTIC_SVC_TOKEN"],
      ec2_inference: ["EC2_INFERENCE_URL", "EC2_INFERENCE_API_KEY"],
      aws_s3: ["S3_BUCKET", "S3_REGION", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY"],
    };
    for (const [id, keys] of Object.entries(ENV_BACKED)) {
      const present = keys.filter((k) => (Deno.env.get(k) ?? "").trim().length > 0);
      if (!present.length) continue;
      const entry = fieldsByIntegration[id] ??= { fields: [], updated_at: null };
      entry.env_fields = present;
      for (const k of present) if (!entry.fields.includes(k)) entry.fields.push(k);
    }

    return json({ status: fieldsByIntegration, lastTest });

  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "Unknown" }, 500);
  }
});

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
