import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

export type DemoRequestStatus = "new" | "contacted" | "scheduled" | "completed" | "declined";

export interface DemoRequest {
  id: string;
  requested_by: string;
  company_name: string;
  contact_name: string;
  contact_email: string;
  contact_phone: string | null;
  team_size: string | null;
  use_case: string;
  preferred_timing: string | null;
  status: DemoRequestStatus;
  scheduled_at: string | null;
  admin_notes: string | null;
  status_changed_at: string;
  created_at: string;
  updated_at: string;
}

export interface NewDemoRequest {
  company_name: string;
  contact_name: string;
  contact_email: string;
  contact_phone?: string;
  team_size?: string;
  use_case: string;
  preferred_timing?: string;
}

/**
 * Demo requests for enterprise accounts. Row-level rules already decide what a
 * caller may see: an ordinary member reads only their own requests, an admin
 * reads and manages every request, so one query serves both.
 */
export const useDemoRequests = () => {
  const { user, isAdmin } = useAuth();
  const [requests, setRequests] = useState<DemoRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!user) {
      setRequests([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const { data, error: queryError } = await supabase
      .from("demo_requests")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(200);
    if (queryError) {
      setError(queryError.message);
      setRequests([]);
    } else {
      setError(null);
      setRequests((data ?? []) as DemoRequest[]);
    }
    setLoading(false);
  }, [user]);

  useEffect(() => {
    void load();
  }, [load]);

  const create = useCallback(
    async (input: NewDemoRequest) => {
      if (!user) return { ok: false, message: "Sign in first." };
      setBusy(true);
      const { error: insertError } = await supabase.from("demo_requests").insert({
        requested_by: user.id,
        company_name: input.company_name.trim(),
        contact_name: input.contact_name.trim(),
        contact_email: input.contact_email.trim(),
        contact_phone: input.contact_phone?.trim() || null,
        team_size: input.team_size?.trim() || null,
        use_case: input.use_case.trim(),
        preferred_timing: input.preferred_timing?.trim() || null,
      });
      setBusy(false);
      if (insertError) return { ok: false, message: insertError.message };
      await load();
      return { ok: true, message: "Request sent." };
    },
    [user, load],
  );

  const update = useCallback(
    async (
      id: string,
      patch: Partial<Pick<DemoRequest, "status" | "scheduled_at" | "admin_notes">>,
    ) => {
      setBusy(true);
      const { error: updateError } = await supabase
        .from("demo_requests")
        .update(patch)
        .eq("id", id);
      setBusy(false);
      if (updateError) return { ok: false, message: updateError.message };
      await load();
      return { ok: true, message: "Saved." };
    },
    [load],
  );

  const mine = useMemo(
    () => requests.filter((request) => request.requested_by === user?.id),
    [requests, user?.id],
  );

  return { requests, mine, loading, busy, error, isAdmin, reload: load, create, update };
};

export default useDemoRequests;
