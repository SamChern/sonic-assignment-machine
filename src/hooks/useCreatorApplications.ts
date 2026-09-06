import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

export type CreatorApplicationStatus =
  | "new"
  | "reviewing"
  | "approved"
  | "waitlisted"
  | "declined";

export interface CreatorApplication {
  id: string;
  kind: string;
  contact_name: string;
  contact_email: string;
  org_name: string | null;
  website: string | null;
  catalogue_size: string | null;
  use_case: string | null;
  message: string | null;
  status: CreatorApplicationStatus;
  admin_notes: string | null;
  submitted_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface NewCreatorApplication {
  contact_name: string;
  contact_email: string;
  org_name: string;
  website?: string;
  catalogue_size?: string;
  use_case?: string;
}

/**
 * Creator applications. The row rules already decide what a caller may see: an
 * ordinary account reads only the applications it filed, an admin reads and
 * manages every one, so a single query serves both views.
 */
export const useCreatorApplications = () => {
  const { user, isAdmin } = useAuth();
  const [applications, setApplications] = useState<CreatorApplication[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!user) {
      setApplications([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const { data, error: queryError } = await supabase
      .from("access_applications")
      .select("*")
      .eq("kind", "creator")
      .order("created_at", { ascending: false })
      .limit(200);
    if (queryError) {
      setError(queryError.message);
      setApplications([]);
    } else {
      setError(null);
      setApplications((data ?? []) as unknown as CreatorApplication[]);
    }
    setLoading(false);
  }, [user]);

  useEffect(() => {
    void load();
  }, [load]);

  const create = useCallback(
    async (input: NewCreatorApplication) => {
      if (!user) return { ok: false, message: "Sign in first." };
      setBusy(true);
      const { error: insertError } = await supabase.from("access_applications").insert({
        kind: "creator",
        contact_name: input.contact_name.trim(),
        contact_email: input.contact_email.trim(),
        org_name: input.org_name.trim(),
        website: input.website?.trim() || null,
        catalogue_size: input.catalogue_size?.trim() || null,
        use_case: input.use_case?.trim() || null,
        terms_accepted: true,
        submitted_by: user.id,
      });
      setBusy(false);
      if (insertError) return { ok: false, message: insertError.message };
      await load();
      return { ok: true, message: "Application sent." };
    },
    [user, load],
  );

  const update = useCallback(
    async (
      id: string,
      patch: Partial<Pick<CreatorApplication, "status" | "admin_notes">>,
    ) => {
      setBusy(true);
      const { error: updateError } = await supabase
        .from("access_applications")
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
    () => applications.filter((application) => application.submitted_by === user?.id),
    [applications, user?.id],
  );

  const approved = useMemo(
    () => mine.some((application) => application.status === "approved"),
    [mine],
  );

  return {
    applications,
    mine,
    approved,
    loading,
    busy,
    error,
    isAdmin,
    reload: load,
    create,
    update,
  };
};

export default useCreatorApplications;
