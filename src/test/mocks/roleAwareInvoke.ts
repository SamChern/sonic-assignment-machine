// Helpers that emulate the server-side `requireAdmin` guard used by every
// admin edge function, so UI tests can assert role-based access control.
import { onInvoke } from "@/test/mocks/supabaseFunctions";

export type Role = "anon" | "user" | "moderator" | "admin";

/** Functions that are admin-only on the server (see supabase/functions/_shared/admin.ts). */
export const ADMIN_ONLY_FUNCTIONS = [
  "admin-set-credentials",
  "admin-get-credential-status",
  "apple-music-test",
  "spotify-audio-features-test",
  "librosa-rest-test",
  "mcp-test",
  "mcp-call",
  "librosa-mcp-call",
  "aws-proxy",
];

/**
 * Register handlers for the admin-only functions that mirror the real guard:
 * 401 without a session, 403 for signed-in non-admins, and `ok` for admins.
 */
export const mockAdminGuard = (
  role: Role,
  ok: (fn: string) => { data?: unknown; error?: { message: string } | null } = () => ({
    data: { success: true },
  }),
) => {
  for (const fn of ADMIN_ONLY_FUNCTIONS) {
    onInvoke(fn, () => {
      if (role === "anon") return { error: { message: "Edge Function returned 401: Unauthorized" } };
      if (role !== "admin")
        return { error: { message: "Edge Function returned 403: admin role required" } };
      return ok(fn);
    });
  }
};
