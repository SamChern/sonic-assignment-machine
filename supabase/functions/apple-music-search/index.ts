// Apple Music catalog search. Mints a developer JWT (ES256) using credentials
// stored in integration_credentials, then searches the catalog and returns
// results normalized to match the shape used by SpotifySearch so the rest of
// the app can consume them unchanged.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { create as createJwt, getNumericDate } from "https://deno.land/x/djwt@v3.0.2/mod.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// Cache the signed JWT in memory for the lifetime of the function instance.
let cachedJwt: { token: string; expiresAt: number } | null = null;

async function getDeveloperToken(admin: ReturnType<typeof createClient>): Promise<string> {
  if (cachedJwt && cachedJwt.expiresAt > Date.now() + 60_000) {
    return cachedJwt.token;
  }

  const { data: creds, error } = await admin
    .from("integration_credentials")
    .select("field_key, field_value")
    .eq("integration_id", "apple_music");
  if (error) throw new Error(`Failed to read Apple credentials: ${error.message}`);

  const map = new Map<string, string>(
    ((creds as Array<{ field_key: string; field_value: string }> | null) ?? [])
      .map((c) => [c.field_key, c.field_value]),
  );
  const teamId = map.get("APPLE_TEAM_ID") ?? Deno.env.get("APPLE_TEAM_ID");
  const keyId = map.get("APPLE_KEY_ID") ?? Deno.env.get("APPLE_KEY_ID");
  const privateKeyPem = map.get("APPLE_PRIVATE_KEY") ?? Deno.env.get("APPLE_PRIVATE_KEY");

  if (!teamId || !keyId || !privateKeyPem) {
    throw new Error("Apple Music credentials are not configured");
  }

  const pemBody = privateKeyPem
    .replace(/-----BEGIN [^-]+-----/g, "")
    .replace(/-----END [^-]+-----/g, "")
    .replace(/\s+/g, "");
  const der = Uint8Array.from(atob(pemBody), (c) => c.charCodeAt(0));
  const cryptoKey = await crypto.subtle.importKey(
    "pkcs8",
    der.buffer,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );

  const ttlSeconds = 60 * 60 * 6; // 6 hours (Apple max is 6 months)
  const jwt = await createJwt(
    { alg: "ES256", kid: keyId, typ: "JWT" },
    {
      iss: teamId,
      iat: getNumericDate(0),
      exp: getNumericDate(ttlSeconds),
    },
    cryptoKey,
  );

  cachedJwt = { token: jwt, expiresAt: Date.now() + ttlSeconds * 1000 };
  return jwt;
}

// Normalize an Apple Music song to the same shape SpotifySearch returns so the
// rest of the app (handleSpotifyTrack, library save, etc.) keeps working.
function normalizeSong(song: any) {
  const a = song.attributes ?? {};
  const artwork = a.artwork
    ? a.artwork.url
        .replace("{w}", String(a.artwork.width || 300))
        .replace("{h}", String(a.artwork.height || 300))
    : null;
  return {
    id: `apple:${song.id}`,
    name: a.name ?? "Unknown",
    artists: [{ name: a.artistName ?? "Unknown" }],
    album: {
      name: a.albumName ?? "",
      images: artwork ? [{ url: artwork }] : [],
    },
    preview_url: a.previews?.[0]?.url ?? null,
    external_urls: { spotify: a.url ?? "" },
    source: "apple_music",
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { query, type = "songs", storefront = "us" } = await req.json();
    if (!query) throw new Error("Query parameter is required");

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(SUPABASE_URL, SERVICE_KEY);

    const token = await getDeveloperToken(admin);

    const params = new URLSearchParams({
      term: query,
      types: type,
      limit: "10",
    });
    const resp = await fetch(
      `https://api.music.apple.com/v1/catalog/${storefront}/search?${params}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );

    if (!resp.ok) {
      const errText = await resp.text();
      throw new Error(`Apple Music search failed (${resp.status}): ${errText.slice(0, 200)}`);
    }

    const data = await resp.json();
    const songs = (data?.results?.songs?.data ?? []).map(normalizeSong);

    // Match SpotifySearch's response shape: { tracks: { items: [...] } }
    return json({ tracks: { items: songs } });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    console.error("apple-music-search error:", message);
    return json({ error: message, apple_music_unavailable: true });
  }
});

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
