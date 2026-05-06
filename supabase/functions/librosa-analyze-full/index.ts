// Proxy to the Librosa REST /analyze_full endpoint, with optional persistence
// of the resulting feature blob into audio_sources.librosa_features.
//
// Body: { audio_url?: string, audio_b64?: string, youtube_url?: string,
//         audio_source_id?: string, duration?: number,
//         n_mfcc?: number, max_frames?: number, recurrence_size?: number }
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

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
    const userId = userData.user.id;

    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return json({ success: false, error: "Body must be JSON" }, 400);
    }

    const sources = ["audio_url", "audio_b64", "youtube_url"].filter(
      (k) => typeof (body as Record<string, unknown>)[k] === "string" &&
             ((body as Record<string, string>)[k] ?? "").length > 0,
    );
    if (sources.length !== 1) {
      return json(
        { success: false, error: "Provide exactly one of audio_url, audio_b64, youtube_url." },
        400,
      );
    }

    const admin = createClient(SUPABASE_URL, SERVICE_KEY);

    // If the caller passed an audio_source_id and we already have a cached
    // librosa_features blob, return it without hitting EC2.
    const audioSourceId = typeof body.audio_source_id === "string" ? body.audio_source_id : null;
    if (audioSourceId) {
      const { data: existing } = await admin
        .from("audio_sources")
        .select("librosa_features, user_id")
        .eq("id", audioSourceId)
        .maybeSingle();
      if (existing?.librosa_features) {
        return json({ success: true, cached: true, result: existing.librosa_features });
      }
    }

    const { data: credRows, error: credErr } = await admin
      .from("integration_credentials")
      .select("field_key, field_value")
      .eq("integration_id", INTEGRATION_ID);
    if (credErr) return json({ success: false, error: credErr.message }, 500);

    const creds: Record<string, string> = {};
    for (const r of credRows ?? []) creds[r.field_key] = r.field_value;

    const baseUrl = (creds.LIBROSA_REST_URL || "").replace(/\/+$/, "");
    const token = creds.LIBROSA_REST_TOKEN;
    if (!baseUrl || !token) {
      return json(
        { success: false, error: "Librosa REST API not configured by admin" },
        503,
      );
    }

    // Forward only the fields the upstream expects.
    const upstreamBody: Record<string, unknown> = {};
    for (const k of [
      "audio_url",
      "audio_b64",
      "youtube_url",
      "duration",
      "n_mfcc",
      "max_frames",
      "recurrence_size",
    ]) {
      if (k in body) upstreamBody[k] = (body as Record<string, unknown>)[k];
    }

    let resp: Response;
    let text = "";
    try {
      resp = await fetch(`${baseUrl}/analyze_full`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(upstreamBody),
        signal: AbortSignal.timeout(180_000),
      });
      text = await resp.text();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Network error";
      return json({ success: false, error: `Upstream fetch failed: ${msg}` }, 502);
    }

    if (!resp.ok) {
      return json(
        { success: false, error: `Upstream HTTP ${resp.status}: ${text.slice(0, 500)}` },
        502,
      );
    }

    let parsed: Record<string, unknown> | null = null;
    try { parsed = JSON.parse(text); } catch {
      return json({ success: false, error: `Unparseable upstream response: ${text.slice(0, 300)}` }, 502);
    }

    // Persist back to the audio_sources row if requested and the caller owns it.
    if (audioSourceId && parsed) {
      const { error: updErr } = await admin
        .from("audio_sources")
        .update({ librosa_features: parsed })
        .eq("id", audioSourceId)
        .eq("user_id", userId);
      if (updErr) {
        console.warn("Failed to persist librosa_features:", updErr.message);
      }
    }

    return json({ success: true, cached: false, result: parsed });
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
