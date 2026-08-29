// Shared caller authorization for privileged edge functions.
//
// Three accepted callers:
//   1. A scheduled/internal invocation presenting the service role key.
//   2. A scheduled (pg_cron) invocation presenting INTERNAL_JOB_SECRET in the
//      `x-internal-job-secret` header — cron has no user session to borrow.
//   3. A signed-in user who holds the 'admin' role in public.user_roles.
// Everything else is rejected before any privileged work happens.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

export interface AdminCaller {
  /** true when the caller is a scheduled/internal run (service role key). */
  isInternal: boolean;
  /** auth user id of the admin caller, null for internal runs. */
  userId: string | null;
}

export class AuthzError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

/**
 * Resolves the caller of a privileged endpoint.
 * Throws AuthzError (401/403) when the caller is not an admin or internal run.
 */
export async function requireAdmin(
  req: Request,
  admin: ReturnType<typeof createClient>,
): Promise<AdminCaller> {
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const authHeader = req.headers.get("Authorization") ?? "";
  const bearer = authHeader.replace(/^Bearer\s+/i, "").trim();

  // Scheduled runs: constant-time-ish compare on a dedicated job secret.
  const jobSecret = Deno.env.get("INTERNAL_JOB_SECRET");
  const presented = req.headers.get("x-internal-job-secret");
  if (jobSecret && presented && presented.length === jobSecret.length && presented === jobSecret) {
    return { isInternal: true, userId: null };
  }

  if (!bearer) throw new AuthzError("Missing auth", 401);
  if (bearer === SERVICE_KEY) return { isInternal: true, userId: null };


  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${bearer}` } },
  });
  const { data: userData, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userData.user) throw new AuthzError("Unauthorized", 401);

  const { data: isAdmin, error: roleErr } = await admin.rpc("has_role", {
    _user_id: userData.user.id,
    _role: "admin",
  });
  if (roleErr) throw new AuthzError("Role check failed", 403);
  if (!isAdmin) throw new AuthzError("Admin only", 403);

  return { isInternal: false, userId: userData.user.id };
}
