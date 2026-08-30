import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export type GuideKind = "glossary" | "runbook";
export type GuideStatus = "live" | "partial" | "planned";

export interface GuideEntry {
  id: string;
  slug: string;
  title: string;
  kind: GuideKind;
  category: string;
  body: string;
  status: GuideStatus;
  version: string | null;
  related_routes: string[];
  related_functions: string[];
  verify_note: string | null;
  sort_order: number;
  archived: boolean;
  updated_at: string;
}

export type GuideDraft = Pick<
  GuideEntry,
  "slug" | "title" | "kind" | "category" | "body" | "status" | "verify_note"
> &
  Partial<Pick<GuideEntry, "related_routes" | "related_functions" | "sort_order" | "version">>;

/**
 * Admin-only reader/writer for `admin_guide_entries`: the in-app glossary and
 * setup runbook. Content lives in the database so an admin can keep it current
 * without a deploy.
 */
export function useAdminGuide() {
  const [entries, setEntries] = useState<GuideEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error: err } = await supabase
      .from("admin_guide_entries")
      .select("*")
      .order("kind")
      .order("sort_order")
      .order("title");
    setError(err ? err.message : null);
    setEntries((data ?? []) as unknown as GuideEntry[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const save = useCallback(
    async (draft: GuideDraft, id?: string) => {
      const { data: sessionData } = await supabase.auth.getSession();
      const payload = {
        ...draft,
        related_routes: draft.related_routes ?? [],
        related_functions: draft.related_functions ?? [],
        sort_order: draft.sort_order ?? 100,
        updated_by: sessionData.session?.user.id ?? null,
      };
      const res = id
        ? await supabase.from("admin_guide_entries").update(payload).eq("id", id)
        : await supabase.from("admin_guide_entries").insert(payload);
      if (res.error) throw new Error(res.error.message);
      await load();
    },
    [load],
  );

  const setArchived = useCallback(
    async (id: string, archived: boolean) => {
      const { error: err } = await supabase
        .from("admin_guide_entries")
        .update({ archived })
        .eq("id", id);
      if (err) throw new Error(err.message);
      await load();
    },
    [load],
  );

  const lastUpdated = useMemo(() => {
    const stamps = entries.map((e) => e.updated_at).sort();
    return stamps.length ? stamps[stamps.length - 1] : null;
  }, [entries]);

  return { entries, loading, error, reload: load, save, setArchived, lastUpdated };
}
