// Tester for the spotify_audio_features integration. Admin-only.
//
// Performs a real round-trip:
//   1. Request a Client Credentials access token from Spotify
//   2. Call /v1/audio-features/{id} with a known public track ID
//      (Daft Punk - "Get Lucky" — picked because it's public, popular, and
//      its features have existed since long before the Nov 2024 deprecation)
//
// This catches the three failure modes that matter:
//   - Missing or invalid SPOTIFY_CLIENT_ID/SECRET            (token call fails)
//   - App created post-Nov-2024 + restricted endpoint         (HTTP 403 on /audio-features)
//   - Spotify outage / network issue                          (timeout / 5xx)
//
// Records outcome in integration_test_history like the other testers.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { requireAdmin, AuthzError } from "../_shared/admin.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const INTEGRATION_ID = "spotify_audio_features";
// Daft Punk - "Get Lucky" (public, predates audio-features deprecation).
const PROBE_TRACK_ID = "2Foc5Q5nqNiosCNqttzHof";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const startedAt = Date.now();

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const SPOTIFY_CLIENT_ID = Deno.env.get("SPOTIFY_CLIENT_ID")?.trim();
    const SPOTIFY_CLIENT_SECRET = Deno.env.get("SPOTIFY_CLIENT_SECRET")?.trim();

    // Uniform authorization: admin role or internal service-role invocation.
    const admin = createClient(SUPABASE_URL, SERVICE_KEY);
    const authz = await requireAdmin(req, admin).catch((e) => e as AuthzError);
    if (authz instanceof AuthzError) {
      return json({ success: false, error: authz.message }, authz.status);
    }

    if (!SPOTIFY_CLIENT_ID || !SPOTIFY_CLIENT_SECRET) {
      return await record(
        admin, userData.user.id, false, startedAt,
        "Spotify credentials not configured — set them in the Spotify card above first.",
      );
    }

    // 1. Get an access token
    let token: string;
    try {
      const tokenResp = await fetch("https://accounts.spotify.com/api/token", {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Authorization: `Basic ${btoa(`${SPOTIFY_CLIENT_ID}:${SPOTIFY_CLIENT_SECRET}`)}`,
        },
        body: "grant_type=client_credentials",
        signal: AbortSignal.timeout(10_000),
      });
      const tokenText = await tokenResp.text();
      if (!tokenResp.ok) {
        return await record(
          admin, userData.user.id, false, startedAt,
          `Spotify token request failed: HTTP ${tokenResp.status}: ${tokenText.slice(0, 200)}`,
        );
      }
      const parsed = JSON.parse(tokenText) as { access_token?: string };
      if (!parsed.access_token) {
        return await record(
          admin, userData.user.id, false, startedAt,
          "Spotify returned no access_token",
        );
      }
      token = parsed.access_token;
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Network error";
      return await record(
        admin, userData.user.id, false, startedAt,
        `Token fetch failed: ${msg}`,
      );
    }

    // 2. Probe /audio-features/{id}
    let featResp: Response;
    let featText = "";
    try {
      featResp = await fetch(
        `https://api.spotify.com/v1/audio-features/${PROBE_TRACK_ID}`,
        {
          headers: { Authorization: `Bearer ${token}` },
          signal: AbortSignal.timeout(10_000),
        },
      );
      featText = await featResp.text();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Network error";
      return await record(
        admin, userData.user.id, false, startedAt,
        `Audio-features fetch failed: ${msg}`,
      );
    }

    if (featResp.status === 403) {
      // The Nov 2024 deprecation case — surface clearly so the admin knows
      // they need a grandfathered app or the librosa fallback.
      return await record(
        admin, userData.user.id, false, startedAt,
        "Spotify HTTP 403: /audio-features is restricted for this app. " +
          "Apps registered after Nov 27, 2024 lost access to this endpoint. " +
          "Use a pre-existing Spotify app or fall back to the Librosa REST API.",
        { status: 403, body: featText.slice(0, 200) },
      );
    }

    if (!featResp.ok) {
      return await record(
        admin, userData.user.id, false, startedAt,
        `Spotify HTTP ${featResp.status}: ${featText.slice(0, 200)}`,
      );
    }

    let parsed: { tempo?: number; key?: number; energy?: number } = {};
    try { parsed = JSON.parse(featText); } catch {
      return await record(
        admin, userData.user.id, false, startedAt,
        `Unparseable audio-features response: ${featText.slice(0, 200)}`,
      );
    }

    if (typeof parsed.tempo !== "number") {
      return await record(
        admin, userData.user.id, false, startedAt,
        "Audio-features response missing tempo — unexpected shape",
        parsed,
      );
    }

    return await record(admin, userData.user.id, true, startedAt, null, {
      probe_track: PROBE_TRACK_ID,
      tempo: parsed.tempo,
      key: parsed.key,
      energy: parsed.energy,
    });
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
