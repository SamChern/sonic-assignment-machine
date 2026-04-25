// Returns which fields are configured for each integration (boolean only).
// Never returns actual credential values.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

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
    const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader.startsWith("Bearer ")) {
      return json({ error: "Missing auth" }, 401);
    }

    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData.user) return json({ error: "Unauthorized" }, 401);

    const admin = createClient(SUPABASE_URL, SERVICE_KEY);
    const { data: roleRow } = await admin
      .from("user_roles")
      .select("role")
      .eq("user_id", userData.user.id)
      .eq("role", "admin")
      .maybeSingle();
    if (!roleRow) return json({ error: "Admin only" }, 403);

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

    const fieldsByIntegration: Record<string, { fields: string[]; updated_at: string | null }> = {};
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
