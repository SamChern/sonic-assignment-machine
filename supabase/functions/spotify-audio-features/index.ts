// spotify-audio-features — fetch tempo, key, energy, valence, danceability, etc.
// for one or more Spotify track IDs using the Client Credentials flow.
//
// Body:  { track_ids: string[] }      // 1..100 Spotify track IDs (NOT URIs/URLs)
// Reply: {
//   success: true,
//   features: Array<{ id, tempo, key, mode, time_signature, energy, valence,
//                     danceability, acousticness, instrumentalness, liveness,
//                     speechiness, loudness, duration_ms }>
// }
//
// Note: Spotify deprecated /audio-features for *new* apps registered after
// Nov 2024. Apps registered before that date (like ours) still have access.
// If the call returns 403 Forbidden, we surface a clear error so the UI can
// fall back to a different signal (file upload + librosa, AcousticBrainz, etc.).
//
// Auth: caller must be a logged-in Lovable user (verify_jwt = true is the default).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const SPOTIFY_CLIENT_ID = Deno.env.get("SPOTIFY_CLIENT_ID")?.trim();
const SPOTIFY_CLIENT_SECRET = Deno.env.get("SPOTIFY_CLIENT_SECRET")?.trim();

interface AudioFeaturesRaw {
  id: string;
  tempo: number;
  key: number;
  mode: number;
  time_signature: number;
  energy: number;
  valence: number;
  danceability: number;
  acousticness: number;
  instrumentalness: number;
  liveness: number;
  speechiness: number;
  loudness: number;
  duration_ms: number;
}

async function getSpotifyToken(): Promise<string> {
  const resp = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${btoa(`${SPOTIFY_CLIENT_ID}:${SPOTIFY_CLIENT_SECRET}`)}`,
    },
    body: "grant_type=client_credentials",
  });
  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`Spotify token request failed: HTTP ${resp.status}: ${err}`);
  }
  const data = await resp.json();
  return data.access_token as string;
}

// Sanitize: accept a Spotify URL, URI, or bare ID; return a 22-char base62 id.
function normalizeTrackId(input: string): string | null {
  if (!input || typeof input !== "string") return null;
  const trimmed = input.trim();
  // spotify:track:ID
  const uriMatch = trimmed.match(/^spotify:track:([A-Za-z0-9]{22})$/);
  if (uriMatch) return uriMatch[1];
  // https://open.spotify.com/track/ID?si=...
  const urlMatch = trimmed.match(/open\.spotify\.com\/track\/([A-Za-z0-9]{22})/);
  if (urlMatch) return urlMatch[1];
  // Bare ID
  if (/^[A-Za-z0-9]{22}$/.test(trimmed)) return trimmed;
  return null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    if (!SPOTIFY_CLIENT_ID || !SPOTIFY_CLIENT_SECRET) {
      return json(
        { success: false, error: "Spotify credentials not configured on the server" },
        500,
      );
    }

    // Verify caller is authenticated (no admin requirement — any logged-in user)
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
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

    // Parse + validate body
    const body = await req.json().catch(() => null);
    const rawIds = Array.isArray(body?.track_ids) ? body.track_ids : null;
    if (!rawIds || rawIds.length === 0) {
      return json({ success: false, error: "track_ids[] is required" }, 400);
    }
    if (rawIds.length > 100) {
      return json({ success: false, error: "Max 100 track_ids per call" }, 400);
    }

    const normalized: string[] = [];
    const invalid: string[] = [];
    for (const raw of rawIds) {
      const id = normalizeTrackId(String(raw));
      if (id) normalized.push(id);
      else invalid.push(String(raw));
    }
    if (normalized.length === 0) {
      return json(
        { success: false, error: "No valid Spotify track IDs found", invalid },
        400,
      );
    }

    const token = await getSpotifyToken();

    // GET /v1/audio-features?ids=id1,id2,... (max 100)
    const resp = await fetch(
      `https://api.spotify.com/v1/audio-features?ids=${normalized.join(",")}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );

    const text = await resp.text();
    if (!resp.ok) {
      // Common case: Spotify deprecated /audio-features for apps registered
      // after Nov 2024. Surface a clear, actionable message.
      let hint = "";
      if (resp.status === 403) {
        hint = " (Spotify may have restricted /audio-features for this app — see https://developer.spotify.com/blog/2024-11-27-changes-to-the-web-api)";
      }
      return json(
        {
          success: false,
          error: `Spotify HTTP ${resp.status}: ${text.slice(0, 300)}${hint}`,
          spotify_unavailable: resp.status === 403,
        },
        200, // 200 so the client can read the body easily
      );
    }

    let parsed: { audio_features?: (AudioFeaturesRaw | null)[] } = {};
    try { parsed = JSON.parse(text); } catch {
      return json({ success: false, error: "Unparseable Spotify response" }, 502);
    }

    const features = (parsed.audio_features ?? []).filter(
      (f): f is AudioFeaturesRaw => f !== null,
    );

    return json({
      success: true,
      requested: normalized.length,
      returned: features.length,
      invalid_inputs: invalid,
      features,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return json({ success: false, error: msg }, 500);
  }
});

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
