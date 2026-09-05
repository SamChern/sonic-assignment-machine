/**
 * sonic-passport — Batch E, item 6.
 *
 * A portable, signed, revocable sonic profile: fingerprint, archetype, consent
 * scopes and ledger references, sealed with an HMAC so any holder can verify it
 * without database access, and revocable so a holder can withdraw it.
 *
 * Admin-only until `nextlevel.passport_enabled` is flipped in the Control Room;
 * after that a signed-in user may issue and revoke their own passport.
 *
 * Actions: issue | verify | revoke | list
 */
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { z } from "npm:zod@3";
import { AuthzError, requireAdmin } from "../_shared/admin.ts";
import { controlBoolean } from "../_shared/control.ts";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const AXES = [
  "emotional",
  "cognitive",
  "social",
  "communication",
  "contextual",
  "artistic",
] as const;

const BodySchema = z.object({
  action: z.enum(["issue", "verify", "revoke", "list"]),
  vector: z.record(z.string(), z.number()).optional(),
  archetype_slug: z.string().max(120).optional(),
  consent_scopes: z.array(z.string().max(60)).max(20).optional(),
  ledger_refs: z.array(z.string().max(120)).max(50).optional(),
  subject_ref: z.string().max(200).optional(),
  passport: z.record(z.string(), z.unknown()).optional(),
  signature: z.string().max(200).optional(),
  passport_id: z.string().uuid().optional(),
});

const enc = new TextEncoder();

/** Stable JSON so a re-serialised payload verifies against the same HMAC. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    return `{${Object.keys(obj)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical(obj[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

const hex = (buf: ArrayBuffer) =>
  Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

async function sign(payload: unknown, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return hex(await crypto.subtle.sign("HMAC", key, enc.encode(canonical(payload))));
}

async function subjectHash(payload: unknown): Promise<string> {
  return hex(await crypto.subtle.digest("SHA-256", enc.encode(canonical(payload)))).slice(0, 32);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );

  try {
    const parsed = BodySchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      return json({ success: false, error: parsed.error.flatten().fieldErrors }, 400);
    }
    const body = parsed.data;

    const secret = Deno.env.get("PASSPORT_SIGNING_KEY");
    if (!secret) return json({ success: false, error: "Signing key not configured" }, 500);

    // Verification needs no session: the HMAC is the proof.
    if (body.action === "verify") {
      if (!body.passport || !body.signature) {
        return json({ success: false, error: "passport and signature are required" }, 400);
      }
      const expected = await sign(body.passport, secret);
      const valid = expected.length === body.signature.length && expected === body.signature;
      let revoked = false;
      if (valid) {
        const { data } = await admin
          .from("sonic_passports")
          .select("revoked_at")
          .eq("signature", body.signature)
          .maybeSingle();
        revoked = Boolean(data?.revoked_at);
      }
      return json({ success: true, valid, revoked, active: valid && !revoked });
    }

    // Everything else is admin-only until the flag is flipped.
    const flagOn = await controlBoolean(admin, "nextlevel.passport_enabled", false);
    let userId: string | null = null;
    let isAdmin = false;
    try {
      const caller = await requireAdmin(req, admin);
      userId = caller.userId;
      isAdmin = true;
    } catch (err) {
      if (!flagOn) throw err;
      // Flag on: accept any signed-in user, scoped to their own passports.
      const bearer = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
      if (!bearer) throw err;
      const userClient = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_ANON_KEY")!,
        { global: { headers: { Authorization: `Bearer ${bearer}` } } },
      );
      const { data } = await userClient.auth.getUser();
      if (!data.user) throw err;
      userId = data.user.id;
    }

    if (body.action === "list") {
      const query = admin
        .from("sonic_passports")
        .select("id, subject_hash, consent_scopes, issued_at, revoked_at, payload")
        .order("issued_at", { ascending: false })
        .limit(50);
      const { data, error } = isAdmin ? await query : await query.eq("user_id", userId);
      if (error) throw error;
      return json({ success: true, passports: data ?? [] });
    }

    if (body.action === "revoke") {
      if (!body.passport_id) return json({ success: false, error: "passport_id required" }, 400);
      let update = admin
        .from("sonic_passports")
        .update({ revoked_at: new Date().toISOString() })
        .eq("id", body.passport_id);
      if (!isAdmin) update = update.eq("user_id", userId);
      const { error } = await update;
      if (error) throw error;
      return json({ success: true, revoked: body.passport_id });
    }

    // issue
    const vector: Record<string, number> = {};
    for (const axis of AXES) vector[axis] = Math.round(Number(body.vector?.[axis] ?? 0));

    const payload = {
      version: "passport-v1",
      issued_at: new Date().toISOString(),
      subject_ref: body.subject_ref ?? null,
      vector,
      archetype_slug: body.archetype_slug ?? null,
      consent_scopes: body.consent_scopes ?? [],
      ledger_refs: body.ledger_refs ?? [],
    };
    const signature = await sign(payload, secret);
    const hash = await subjectHash({ vector, subject_ref: payload.subject_ref });

    const { data, error } = await admin
      .from("sonic_passports")
      .insert({
        subject_hash: hash,
        user_id: userId,
        payload,
        signature,
        consent_scopes: payload.consent_scopes,
      })
      .select("id, subject_hash, issued_at")
      .single();
    if (error) throw error;

    return json({ success: true, passport: payload, signature, record: data });
  } catch (err) {
    if (err instanceof AuthzError) {
      return json({ success: false, error: err.message }, err.status);
    }
    console.error("sonic-passport failed", err);
    return json({ success: false, error: (err as Error).message ?? "Unexpected error" }, 500);
  }
});
