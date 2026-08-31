// Admin team setup: create an organization, invite teammates, assign org roles
// and confirm the invited account has actually signed in.
//
// Body:
//   { action: "orgs" }
//   { action: "create_org", name, slug?, plan? }
//   { action: "invite", organization_id, email, role?, redirect_to? }
//   { action: "set_role", organization_id, user_id, role }
//   { action: "remove_member", organization_id, user_id }
//   { action: "members", organization_id }   — includes last_sign_in_at per member
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { AuthzError, requireAdmin } from "../_shared/admin.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const ORG_ROLES = ["owner", "analyst", "viewer"] as const;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const slugify = (s: string) =>
  s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48);

// deno-lint-ignore no-explicit-any
type Client = any;

/** Members of one org, decorated with email + sign-in state from auth.users. */
async function listMembers(admin: Client, organizationId: string) {
  const { data: members } = await admin
    .from("organization_members")
    .select("user_id, role, created_at")
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: true });

  const rows = [] as Record<string, unknown>[];
  for (const m of (members ?? []) as { user_id: string; role: string; created_at: string }[]) {
    const { data: u } = await admin.auth.admin.getUserById(m.user_id);
    const user = u?.user;
    rows.push({
      user_id: m.user_id,
      role: m.role,
      created_at: m.created_at,
      email: user?.email ?? null,
      invited_at: user?.invited_at ?? null,
      confirmed_at: user?.email_confirmed_at ?? null,
      last_sign_in_at: user?.last_sign_in_at ?? null,
      signed_in: !!user?.last_sign_in_at,
    });
  }
  return rows;
}

async function findUserByEmail(admin: Client, email: string) {
  // Auth admin has no direct email lookup; scan the first pages of users.
  for (let page = 1; page <= 10; page += 1) {
    const { data } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    const users = data?.users ?? [];
    const hit = users.find((u: { email?: string }) => (u.email ?? "").toLowerCase() === email);
    if (hit) return hit;
    if (users.length < 200) break;
  }
  return null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );

  try {
    const authz = await requireAdmin(req, admin).catch((e) => e as AuthzError);
    if (authz instanceof AuthzError) {
      return json({ success: false, error: authz.message }, authz.status);
    }

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const action = String(body.action ?? "orgs");

    if (action === "orgs") {
      const { data: orgs, error } = await admin
        .from("organizations")
        .select("id, name, slug, plan, created_at")
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) return json({ success: false, error: error.message }, 500);
      const counts: Record<string, number> = {};
      const { data: members } = await admin
        .from("organization_members")
        .select("organization_id")
        .limit(5000);
      for (const m of (members ?? []) as { organization_id: string }[]) {
        counts[m.organization_id] = (counts[m.organization_id] ?? 0) + 1;
      }
      return json({ success: true, orgs: orgs ?? [], member_counts: counts });
    }

    if (action === "create_org") {
      const name = String(body.name ?? "").trim();
      if (!name) return json({ success: false, error: "name is required" }, 400);
      const slug = slugify(String(body.slug ?? "") || name);
      if (!slug) return json({ success: false, error: "slug could not be derived" }, 400);
      const plan = String(body.plan ?? "enterprise");
      const ownerUserId = String(body.owner_user_id ?? authz.userId ?? "");
      if (!ownerUserId) {
        return json({ success: false, error: "an owner user id is required" }, 400);
      }

      const { data: org, error } = await admin
        .from("organizations")
        .insert({ name, slug, plan, owner_user_id: ownerUserId })
        .select("id, name, slug, plan, created_at")
        .single();
      if (error) {
        const dup = /duplicate key/i.test(error.message);
        return json(
          { success: false, error: dup ? `slug "${slug}" is already taken` : error.message },
          dup ? 409 : 500,
        );
      }
      // The creating admin becomes the org owner so the workspace is reachable.
      await admin
        .from("organization_members")
        .upsert(
          { organization_id: org.id, user_id: ownerUserId, role: "owner" },
          { onConflict: "organization_id,user_id" },
        );
      return json({ success: true, org, members: await listMembers(admin, org.id) });
    }

    const organizationId = String(body.organization_id ?? "");
    if (["invite", "set_role", "members", "remove_member"].includes(action) && !organizationId) {
      return json({ success: false, error: "organization_id is required" }, 400);
    }

    if (action === "members") {
      return json({ success: true, members: await listMembers(admin, organizationId) });
    }

    if (action === "invite") {
      const email = String(body.email ?? "").trim().toLowerCase();
      const role = String(body.role ?? "viewer");
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
        return json({ success: false, error: "a valid email is required" }, 400);
      }
      if (!ORG_ROLES.includes(role as typeof ORG_ROLES[number])) {
        return json({ success: false, error: `role must be one of ${ORG_ROLES.join(", ")}` }, 400);
      }
      const redirectTo = String(body.redirect_to ?? "") || undefined;

      let userId: string | null = null;
      let invited = false;
      const { data: inviteData, error: inviteErr } = await admin.auth.admin.inviteUserByEmail(
        email,
        redirectTo ? { redirectTo } : undefined,
      );
      if (inviteData?.user?.id) {
        userId = inviteData.user.id;
        invited = true;
      } else {
        // Already registered: link the existing account instead of failing.
        const existing = await findUserByEmail(admin, email);
        if (!existing) {
          return json(
            { success: false, error: inviteErr?.message ?? "invite failed" },
            400,
          );
        }
        userId = existing.id;
      }

      const { error: memberErr } = await admin
        .from("organization_members")
        .upsert(
          { organization_id: organizationId, user_id: userId, role },
          { onConflict: "organization_id,user_id" },
        );
      if (memberErr) return json({ success: false, error: memberErr.message }, 500);

      return json({
        success: true,
        invited,
        user_id: userId,
        email,
        role,
        members: await listMembers(admin, organizationId),
      });
    }

    if (action === "set_role") {
      const userId = String(body.user_id ?? "");
      const role = String(body.role ?? "");
      if (!userId || !ORG_ROLES.includes(role as typeof ORG_ROLES[number])) {
        return json({ success: false, error: "user_id and a valid role are required" }, 400);
      }
      const { error } = await admin
        .from("organization_members")
        .update({ role })
        .eq("organization_id", organizationId)
        .eq("user_id", userId);
      if (error) return json({ success: false, error: error.message }, 500);
      return json({ success: true, members: await listMembers(admin, organizationId) });
    }

    if (action === "remove_member") {
      const userId = String(body.user_id ?? "");
      if (!userId) return json({ success: false, error: "user_id is required" }, 400);
      const { error } = await admin
        .from("organization_members")
        .delete()
        .eq("organization_id", organizationId)
        .eq("user_id", userId);
      if (error) return json({ success: false, error: error.message }, 500);
      return json({ success: true, members: await listMembers(admin, organizationId) });
    }

    return json({ success: false, error: `unknown action: ${action}` }, 400);
  } catch (e) {
    console.error("admin-org-setup failed", e);
    return json({ success: false, error: (e as Error).message }, 500);
  }
});
