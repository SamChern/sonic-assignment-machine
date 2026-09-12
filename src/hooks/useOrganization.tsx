import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import {
  ALL_CAPABILITIES,
  type Capabilities,
  toCapabilities,
} from "@/lib/orgCapabilities";

export interface OrgMembership {
  organization_id: string;
  role: string;
  name: string;
  slug: string;
  plan: string;
}

/**
 * Resolves the signed-in user's enterprise organizations. RLS already limits
 * rows to organizations the user belongs to, so no extra filtering is needed.
 */
export function useOrganization() {
  const { user, loading: authLoading } = useAuth();
  const [orgs, setOrgs] = useState<OrgMembership[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [capsByOrg, setCapsByOrg] = useState<Record<string, Capabilities>>({});
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!user) {
      setOrgs([]);
      setActiveId(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    const { data, error } = await supabase
      .from("organization_members")
      .select("organization_id, role, organizations(name, slug, plan)")
      .eq("user_id", user.id);

    if (!error && data) {
      const mapped: OrgMembership[] = data.map((row) => {
        const org = row.organizations as { name: string; slug: string; plan: string } | null;
        return {
          organization_id: row.organization_id as string,
          role: String(row.role),
          name: org?.name ?? "Organization",
          slug: org?.slug ?? "",
          plan: org?.plan ?? "enterprise",
        };
      });
      setOrgs(mapped);
      setActiveId((prev) => prev ?? mapped[0]?.organization_id ?? null);

      // Access switches set by a platform admin. Missing row = everything on.
      const { data: capRows } = await supabase.from("org_capabilities").select("*");
      const next: Record<string, Capabilities> = {};
      for (const row of capRows ?? []) {
        next[String((row as { organization_id: string }).organization_id)] = toCapabilities(
          row as Record<string, unknown>,
        );
      }
      setCapsByOrg(next);
    }
    setLoading(false);
  }, [user]);

  useEffect(() => {
    if (authLoading) return;
    void load();
  }, [authLoading, load]);

  const active = orgs.find((o) => o.organization_id === activeId) ?? null;
  const capabilities = active
    ? capsByOrg[active.organization_id] ?? ALL_CAPABILITIES
    : ALL_CAPABILITIES;

  /** Switches for any organization the user belongs to (per-account portals). */
  const capabilitiesFor = useCallback(
    (organizationId: string | null) =>
      organizationId ? capsByOrg[organizationId] ?? ALL_CAPABILITIES : ALL_CAPABILITIES,
    [capsByOrg],
  );

  return {
    orgs,
    active,
    activeId,
    setActiveId,
    capabilities,
    capabilitiesFor,
    role: active?.role ?? null,
    canWrite: active ? ["owner", "analyst"].includes(active.role) : false,
    // Only org owners (enterprise admins) may edit the 6 semantic categories.
    isOrgAdmin: active ? active.role === "owner" : false,

    loading: authLoading || loading,
    reload: load,
  };
}
