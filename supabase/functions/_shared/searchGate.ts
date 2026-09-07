/**
 * searchGate — stops the catalogue search proxies being used as a free,
 * unlimited gateway to our paid Spotify / Apple Music credentials.
 *
 * A signed-in caller with a valid session is always allowed. An anonymous
 * caller (the signed-out trial still offers catalogue search) is allowed a
 * bounded number of searches per IP per UTC day, counted by consume_guest_run.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const ANON_DAILY_LIMIT = 40;

export interface GateResult {
  allowed: boolean;
  reason?: string;
}

async function hashKey(value: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 40);
}

export async function allowSearchCaller(req: Request, scope: string): Promise<GateResult> {
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

  const authHeader = req.headers.get("Authorization") ?? "";
  const bearer = authHeader.replace(/^Bearer\s+/i, "").trim();

  // A session token (not the plain anon key) means a real signed-in caller.
  if (bearer && bearer !== anonKey) {
    const asUser = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: `Bearer ${bearer}` } },
      auth: { persistSession: false },
    });
    const { data, error } = await asUser.auth.getUser();
    if (!error && data?.user) return { allowed: true };
    return { allowed: false, reason: "Your session has expired. Please sign in again." };
  }

  // Anonymous: bounded per-IP daily quota.
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("cf-connecting-ip") ||
    "unknown";
  const key = `${scope}:${await hashKey(ip)}`;

  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
  const { data, error } = await admin.rpc("consume_guest_run", {
    p_key: key,
    p_limit: ANON_DAILY_LIMIT,
  });
  if (error) return { allowed: false, reason: "Search is temporarily unavailable." };

  const allowed = (data as { allowed?: boolean } | null)?.allowed === true;
  return allowed
    ? { allowed: true }
    : { allowed: false, reason: "Daily search limit reached. Sign in to keep searching." };
}
