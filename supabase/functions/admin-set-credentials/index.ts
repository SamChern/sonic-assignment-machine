// Generic admin-only credential writer. Validates caller is admin, then upserts
// credentials for one integration into the integration_credentials table.
// Allow-listed against the registry below to prevent arbitrary writes.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// Mirror of src/config/integrations.ts allowed field keys per integration.
// Keep in sync when adding providers.
const MCP_FIELDS = [
  "MCP_SERVER_URL",
  "MCP_AUTH_SCHEME",
  "MCP_AUTH_TOKEN",
  "MCP_HEADERS_JSON",
  // Per-capability toggles, one row per capability key
  "MCP_CAP_TOOLS_READ",
  "MCP_CAP_RESOURCES_READ",
  "MCP_CAP_PROMPTS_READ",
  "MCP_CAP_SAMPLING_WRITE",
];

const ALLOWED_FIELDS: Record<string, string[]> = {
  apple_music: ["APPLE_TEAM_ID", "APPLE_KEY_ID", "APPLE_PRIVATE_KEY"],
  spotify: ["SPOTIFY_CLIENT_ID", "SPOTIFY_CLIENT_SECRET"],
  pandora: [
    "PANDORA_PARTNER_USERNAME",
    "PANDORA_PARTNER_PASSWORD",
    "PANDORA_DEVICE_ID",
    "PANDORA_USER_EMAIL",
    "PANDORA_USER_PASSWORD",
  ],
  mcp_generic: MCP_FIELDS,
  mcp_notion: MCP_FIELDS,
  mcp_linear: MCP_FIELDS,
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

    // Verify caller via JWT
    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData.user) return json({ error: "Unauthorized" }, 401);

    // Privileged client for role + writes
    const admin = createClient(SUPABASE_URL, SERVICE_KEY);
    const { data: roleRow } = await admin
      .from("user_roles")
      .select("role")
      .eq("user_id", userData.user.id)
      .eq("role", "admin")
      .maybeSingle();
    if (!roleRow) return json({ error: "Admin only" }, 403);

    const body = await req.json().catch(() => null);
    const integrationId: string | undefined = body?.integration_id;
    const credentials: Record<string, string> | undefined = body?.credentials;

    if (!integrationId || typeof credentials !== "object") {
      return json({ error: "Invalid body" }, 400);
    }
    const allowed = ALLOWED_FIELDS[integrationId];
    if (!allowed) return json({ error: "Unknown integration" }, 400);

    const rows: Array<Record<string, unknown>> = [];
    for (const [key, value] of Object.entries(credentials)) {
      if (!allowed.includes(key)) {
        return json({ error: `Field '${key}' not allowed` }, 400);
      }
      if (typeof value !== "string" || value.trim().length === 0) continue;
      rows.push({
        integration_id: integrationId,
        field_key: key,
        field_value: value,
        updated_by: userData.user.id,
        updated_at: new Date().toISOString(),
      });
    }

    if (rows.length === 0) return json({ error: "No values provided" }, 400);

    const { error: upsertErr } = await admin
      .from("integration_credentials")
      .upsert(rows, { onConflict: "integration_id,field_key" });
    if (upsertErr) return json({ error: upsertErr.message }, 500);

    return json({ success: true, saved: rows.length });
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
