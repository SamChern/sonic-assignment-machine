import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

export interface AdminPerson {
  user_id: string;
  email: string | null;
  username: string | null;
  persona: string | null;
  signed_up_at: string | null;
  last_sign_in_at: string | null;
  roles: string[];
  membership_plan: string | null;
  membership_status: string | null;
  billing_period: string | null;
  price_cents: number | null;
  creator_status: string | null;
  analyses_count: number;
}

export type MembershipStatus = "awaiting_payment" | "active" | "cancelled";
export type BillingPeriod = "monthly" | "annual";

const PAGE_SIZE = 50;

/**
 * The admin people directory. Everything here goes through two admin-only
 * database routines, so the browser never needs write access to memberships and
 * a non-admin session gets nothing back at all.
 */
export const useAdminPeople = () => {
  const { isAdmin } = useAuth();
  const [people, setPeople] = useState<AdminPerson[]>([]);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!isAdmin) {
      setPeople([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const { data, error: queryError } = await supabase.rpc("admin_list_people", {
      p_search: search.trim() || null,
      p_limit: PAGE_SIZE,
      p_offset: page * PAGE_SIZE,
    });
    if (queryError) {
      setError(queryError.message);
      setPeople([]);
    } else {
      setError(null);
      setPeople(((data ?? []) as unknown as AdminPerson[]).map((p) => ({
        ...p,
        roles: p.roles ?? [],
      })));
    }
    setLoading(false);
  }, [isAdmin, search, page]);

  useEffect(() => {
    void load();
  }, [load]);

  const setMembership = useCallback(
    async (userId: string, status: MembershipStatus, billing: BillingPeriod) => {
      setBusy(true);
      const { error: rpcError } = await supabase.rpc("admin_set_membership", {
        p_user_id: userId,
        p_plan: "listener",
        p_status: status,
        p_billing_period: billing,
      });
      setBusy(false);
      if (rpcError) return { ok: false, message: rpcError.message };
      await load();
      return { ok: true, message: "Membership updated." };
    },
    [load],
  );

  const setRole = useCallback(
    async (userId: string, role: "admin" | "moderator", grant: boolean) => {
      setBusy(true);
      const result = grant
        ? await supabase.from("user_roles").insert({ user_id: userId, role })
        : await supabase.from("user_roles").delete().eq("user_id", userId).eq("role", role);
      setBusy(false);
      if (result.error) return { ok: false, message: result.error.message };
      await load();
      return { ok: true, message: grant ? `Granted ${role}.` : `Removed ${role}.` };
    },
    [load],
  );

  return {
    people,
    search,
    setSearch: (value: string) => {
      setPage(0);
      setSearch(value);
    },
    page,
    setPage,
    pageSize: PAGE_SIZE,
    loading,
    busy,
    error,
    reload: load,
    setMembership,
    setRole,
  };
};

export default useAdminPeople;
