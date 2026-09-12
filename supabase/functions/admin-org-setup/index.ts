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

/** Per-account access switches. All default on so existing orgs are unchanged. */
const CAPABILITY_KEYS = [
  "intuizi_console",
  "semantic_model",
  "clap_grounding",
  "eid_enrichment",
  "pixels_tracking",
  "predict_users",
  "predict_outcomes",
  "enrichment_preview",
] as const;

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

/** Capabilities row for an org, creating the all-on default when absent. */
async function ensureCapabilities(admin: Client, organizationId: string, updatedBy: string | null) {
  const { data: existing } = await admin
    .from("org_capabilities")
    .select("*")
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (existing) return existing;
  const { data: created } = await admin
    .from("org_capabilities")
    .insert({ organization_id: organizationId, updated_by: updatedBy })
    .select("*")
    .single();
  return created;
}

/** Resolve an email to an existing account, inviting one when it is new. */
async function resolveUser(admin: Client, email: string, redirectTo?: string) {
  const { data: invited } = await admin.auth.admin.inviteUserByEmail(
    email,
    redirectTo ? { redirectTo } : undefined,
  );
  if (invited?.user?.id) return { userId: invited.user.id as string, invited: true };
  const existing = await findUserByEmail(admin, email);
  if (!existing) return { userId: null, invited: false };
  return { userId: existing.id as string, invited: false };
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
      const { data: caps } = await admin.from("org_capabilities").select("*").limit(500);
      const { data: grants } = await admin
        .from("org_intuizi_activations")
        .select("organization_id, activation_id, is_active")
        .limit(5000);
      const grantCounts: Record<string, number> = {};
      for (const g of (grants ?? []) as { organization_id: string }[]) {
        grantCounts[g.organization_id] = (grantCounts[g.organization_id] ?? 0) + 1;
      }
      return json({
        success: true,
        orgs: orgs ?? [],
        member_counts: counts,
        capabilities: caps ?? [],
        grant_counts: grantCounts,
      });
    }

    if (action === "provision_org") {
      const name = String(body.name ?? "").trim();
      if (!name) return json({ success: false, error: "an account name is required" }, 400);
      const slug = slugify(String(body.slug ?? "") || name);
      if (!slug) return json({ success: false, error: "slug could not be derived" }, 400);
      const plan = String(body.plan ?? "enterprise");
      const ownerEmail = String(body.owner_email ?? "").trim().toLowerCase();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(ownerEmail)) {
        return json({ success: false, error: "a valid owner email is required" }, 400);
      }
      const redirectTo = String(body.redirect_to ?? "") || undefined;

      const { userId: ownerUserId, invited } = await resolveUser(admin, ownerEmail, redirectTo);
      if (!ownerUserId) {
        return json({ success: false, error: `could not invite or find ${ownerEmail}` }, 400);
      }

      // Reuse an existing account with the same slug instead of failing the flow.
      const { data: existingOrg } = await admin
        .from("organizations")
        .select("id, name, slug, plan, created_at")
        .eq("slug", slug)
        .maybeSingle();

      let org = existingOrg;
      if (!org) {
        const { data: created, error: createErr } = await admin
          .from("organizations")
          .insert({ name, slug, plan, owner_user_id: ownerUserId })
          .select("id, name, slug, plan, created_at")
          .single();
        if (createErr) return json({ success: false, error: createErr.message }, 500);
        org = created;
      }

      await admin
        .from("organization_members")
        .upsert(
          { organization_id: org.id, user_id: ownerUserId, role: "owner" },
          { onConflict: "organization_id,user_id" },
        );

      const requested = (body.capabilities ?? null) as Record<string, unknown> | null;
      const caps = await ensureCapabilities(admin, org.id, authz.userId);
      let capabilities = caps;
      if (requested) {
        const patch: Record<string, boolean> = {};
        for (const key of CAPABILITY_KEYS) {
          if (typeof requested[key] === "boolean") patch[key] = requested[key] as boolean;
        }
        if (Object.keys(patch).length) {
          const { data: updated } = await admin
            .from("org_capabilities")
            .update({ ...patch, updated_by: authz.userId })
            .eq("organization_id", org.id)
            .select("*")
            .single();
          capabilities = updated ?? caps;
        }
      }

      return json({
        success: true,
        org,
        owner_invited: invited,
        owner_user_id: ownerUserId,
        capabilities,
        members: await listMembers(admin, org.id),
      });
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
    if (
      [
        "invite",
        "set_role",
        "members",
        "remove_member",
        "set_capabilities",
        "grant_activations",
        "org_detail",
      ].includes(action) && !organizationId
    ) {
      return json({ success: false, error: "organization_id is required" }, 400);
    }

    if (action === "members") {
      return json({ success: true, members: await listMembers(admin, organizationId) });
    }

    if (action === "org_detail") {
      const { data: org, error } = await admin
        .from("organizations")
        .select("id, name, slug, plan, created_at")
        .eq("id", organizationId)
        .maybeSingle();
      if (error) return json({ success: false, error: error.message }, 500);
      if (!org) return json({ success: false, error: "account not found" }, 404);
      const { data: grants } = await admin
        .from("org_intuizi_activations")
        .select("id, activation_id, label, is_active, last_synced_at, created_at")
        .eq("organization_id", organizationId)
        .order("created_at", { ascending: false });
      return json({
        success: true,
        org,
        capabilities: await ensureCapabilities(admin, organizationId, authz.userId),
        grants: grants ?? [],
        members: await listMembers(admin, organizationId),
      });
    }

    if (action === "set_capabilities") {
      const requested = (body.capabilities ?? {}) as Record<string, unknown>;
      const patch: Record<string, unknown> = { updated_by: authz.userId };
      for (const key of CAPABILITY_KEYS) {
        if (typeof requested[key] === "boolean") patch[key] = requested[key];
      }
      if (typeof body.notes === "string") patch.notes = String(body.notes).slice(0, 2000) || null;
      await ensureCapabilities(admin, organizationId, authz.userId);
      const { data: updated, error } = await admin
        .from("org_capabilities")
        .update(patch)
        .eq("organization_id", organizationId)
        .select("*")
        .single();
      if (error) return json({ success: false, error: error.message }, 500);
      return json({ success: true, capabilities: updated });
    }

    if (action === "grant_activations") {
      let ids = Array.isArray(body.activation_ids)
        ? (body.activation_ids as unknown[]).map((v) => String(v).trim().replace(/^#/, ""))
        : [];
      // "All current feeds": activations SonicSIM has already worked with, taken
      // from the cost snapshots plus anything already granted anywhere. Both are
      // tiny tables, so no scan of the million-row scoring queue is needed.
      if (body.all_current === true) {
        const [cacheRes, grantRes] = await Promise.all([
          admin.from("intuizi_cost_estimate_cache").select("activation_id").limit(1000),
          admin.from("org_intuizi_activations").select("activation_id").limit(1000),
        ]);
        ids = [
          ...new Set(
            [...(cacheRes.data ?? []), ...(grantRes.data ?? [])]
              .map((r: { activation_id: unknown }) => String(r.activation_id ?? "").trim())
              .filter(Boolean),
          ),
        ];
      }
      ids = [...new Set(ids.filter(Boolean))];
      if (!ids.length) {
        return json({ success: false, error: "no activation ids to grant" }, 400);
      }
      const { error } = await admin.from("org_intuizi_activations").upsert(
        ids.map((activation_id) => ({
          organization_id: organizationId,
          activation_id,
          granted_by: authz.userId,
        })),
        { onConflict: "organization_id,activation_id", ignoreDuplicates: true },
      );
      if (error) return json({ success: false, error: error.message }, 500);
      const { data: grants } = await admin
        .from("org_intuizi_activations")
        .select("id, activation_id, label, is_active, last_synced_at, created_at")
        .eq("organization_id", organizationId)
        .order("created_at", { ascending: false });
      return json({ success: true, granted: ids.length, grants: grants ?? [] });
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
