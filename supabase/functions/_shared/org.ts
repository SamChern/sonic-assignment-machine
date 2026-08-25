// Shared caller authorization for enterprise (organization-scoped) endpoints.
//
// Accepted callers:
//   1. An internal invocation presenting the service role key.
//   2. A signed-in user who is a member of the requested organization.
//      `write` requires the member to be an owner or analyst.
// Platform admins are always allowed.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

export class AuthzError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export interface OrgCaller {
  isInternal: boolean;
  userId: string | null;
  role: string | null;
}

export async function requireOrgMember(
  req: Request,
  admin: ReturnType<typeof createClient>,
  organizationId: string,
  write = false,
): Promise<OrgCaller> {
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  if (!organizationId) throw new AuthzError("organization_id is required", 400);

  const bearer = (req.headers.get("Authorization") ?? "")
    .replace(/^Bearer\s+/i, "")
    .trim();
  if (!bearer) throw new AuthzError("Missing auth", 401);
  if (bearer === SERVICE_KEY) return { isInternal: true, userId: null, role: "owner" };

  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${bearer}` } },
  });
  const { data: userData, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userData.user) throw new AuthzError("Unauthorized", 401);
  const userId = userData.user.id;

  const { data: isAdmin } = await admin.rpc("has_role", {
    _user_id: userId,
    _role: "admin",
  });
  if (isAdmin) return { isInternal: false, userId, role: "owner" };

  const { data: member, error: memberErr } = await admin
    .from("organization_members")
    .select("role")
    .eq("organization_id", organizationId)
    .eq("user_id", userId)
    .maybeSingle();

  if (memberErr) throw new AuthzError("Membership check failed", 403);
  if (!member) throw new AuthzError("Not a member of this organization", 403);
  if (write && !["owner", "analyst"].includes(String(member.role))) {
    throw new AuthzError("Viewers cannot change this organization's data", 403);
  }
  return { isInternal: false, userId, role: String(member.role) };
}
