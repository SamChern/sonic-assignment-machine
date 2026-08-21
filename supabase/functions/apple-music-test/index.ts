// Mints an Apple Music developer JWT (ES256) and tests it against the catalog.
// Reads credentials from integration_credentials (admin-only managed via UI).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { create as createJwt, getNumericDate } from "https://deno.land/x/djwt@v3.0.2/mod.ts";
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
    const { data: creds, error: credErr } = await admin
      .from("integration_credentials")
      .select("field_key, field_value")
      .eq("integration_id", "apple_music");
    if (credErr) throw new Error(credErr.message);

    const map = new Map((creds ?? []).map((c) => [c.field_key, c.field_value]));
    const teamId = map.get("APPLE_TEAM_ID");
    const keyId = map.get("APPLE_KEY_ID");
    const privateKeyPem = map.get("APPLE_PRIVATE_KEY");

    if (!teamId || !keyId || !privateKeyPem) {
      return await record(admin, authz.userId, false, startedAt, "Missing one or more credentials");
    }

    // Import the .p8 key (PKCS#8 PEM) for ES256 signing
    let cryptoKey: CryptoKey;
    try {
      const pemBody = privateKeyPem
        .replace(/-----BEGIN [^-]+-----/g, "")
        .replace(/-----END [^-]+-----/g, "")
        .replace(/\s+/g, "");
      const der = Uint8Array.from(atob(pemBody), (c) => c.charCodeAt(0));
      cryptoKey = await crypto.subtle.importKey(
        "pkcs8",
        der.buffer,
        { name: "ECDSA", namedCurve: "P-256" },
        false,
        ["sign"],
      );
    } catch (e) {
      return await record(admin, authz.userId, false, startedAt,
        `Invalid .p8 key: ${e instanceof Error ? e.message : String(e)}`);
    }

    // Mint JWT (valid 1 hour)
    let jwt: string;
    try {
      jwt = await createJwt(
        { alg: "ES256", kid: keyId, typ: "JWT" },
        {
          iss: teamId,
          iat: getNumericDate(0),
          exp: getNumericDate(60 * 60),
        },
        cryptoKey,
      );
    } catch (e) {
      return await record(admin, authz.userId, false, startedAt,
        `JWT signing failed: ${e instanceof Error ? e.message : String(e)}`);
    }

    // Cheap test call: fetch catalog test storefront
    const resp = await fetch(
      "https://api.music.apple.com/v1/catalog/us/search?term=test&limit=1&types=songs",
      { headers: { Authorization: `Bearer ${jwt}` } },
    );
    const text = await resp.text();
    if (!resp.ok) {
      return await record(admin, authz.userId, false, startedAt,
        `Apple API ${resp.status}: ${text.slice(0, 300)}`);
    }

    let sample: unknown = null;
    try {
      const parsed = JSON.parse(text);
      const first = parsed?.results?.songs?.data?.[0]?.attributes;
      if (first) sample = { name: first.name, artistName: first.artistName };
    } catch (_) {
      // ignore
    }

    return await record(admin, authz.userId, true, startedAt, null, sample);
  } catch (e) {
    return json({
      success: false,
      error: e instanceof Error ? e.message : "Unknown",
      latency_ms: Date.now() - startedAt,
    }, 500);
  }
});

async function record(
  admin: ReturnType<typeof createClient>,
  userId: string,
  success: boolean,
  startedAt: number,
  error: string | null,
  sample: unknown = null,
) {
  const latency = Date.now() - startedAt;
  await admin.from("integration_test_history").insert({
    integration_id: "apple_music",
    tested_by: userId,
    success,
    latency_ms: latency,
    error_message: error,
    response_sample: sample as never,
  });
  return json({ success, error, latency_ms: latency, sample });
}

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
