// Public endpoint: returns which REST search integrations have all required
// credentials configured. Does NOT expose credential values — only the
// integration id + display name. Used by the home-screen "External Search"
// dropdown to know which providers are usable.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// Mirror of the required-field set for each searchable provider.
// Keep in sync with src/config/integrations.ts (only providers that have a
// search edge function are listed here).
const SEARCH_PROVIDERS: Record<string, { name: string; requiredFields: string[]; searchEndpoint: string }> = {
  apple_music: {
    name: "Apple Music",
    requiredFields: ["APPLE_TEAM_ID", "APPLE_KEY_ID", "APPLE_PRIVATE_KEY"],
    searchEndpoint: "apple-music-search",
  },
  spotify: {
    name: "Spotify",
    requiredFields: ["SPOTIFY_CLIENT_ID", "SPOTIFY_CLIENT_SECRET"],
    searchEndpoint: "spotify-search",
  },
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(SUPABASE_URL, SERVICE_KEY);

    const ids = Object.keys(SEARCH_PROVIDERS);
    const { data: rows, error } = await admin
      .from("integration_credentials")
      .select("integration_id, field_key, field_value")
      .in("integration_id", ids);
    if (error) throw new Error(error.message);

    // Group present non-empty keys by integration_id
    const presentKeys = new Map<string, Set<string>>();
    for (const r of rows ?? []) {
      if (!r.field_value) continue;
      if (!presentKeys.has(r.integration_id)) presentKeys.set(r.integration_id, new Set());
      presentKeys.get(r.integration_id)!.add(r.field_key);
    }

    // Also fall back to env-var-only credentials (e.g. SPOTIFY_CLIENT_ID set as a
    // platform secret without a row in integration_credentials).
    const configured: Array<{ id: string; name: string; searchEndpoint: string }> = [];
    for (const [id, def] of Object.entries(SEARCH_PROVIDERS)) {
      const present = presentKeys.get(id) ?? new Set<string>();
      const allPresent = def.requiredFields.every(
        (k) => present.has(k) || !!Deno.env.get(k),
      );
      if (allPresent) {
        configured.push({ id, name: def.name, searchEndpoint: def.searchEndpoint });
      }
    }

    return json({ providers: configured });
  } catch (e) {
    return json({ providers: [], error: e instanceof Error ? e.message : "Unknown" }, 200);
  }
});

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
