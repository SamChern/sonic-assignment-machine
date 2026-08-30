import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

/**
 * Step 14 — Sound Library data access. Coverage, gaps, queue and grounding
 * packs all come from the admin-only `sound-curator` function so the license
 * and attribution rules are enforced server-side, never in the browser.
 */

export interface CoverageRow {
  branch: string;
  observed_tags: number;
  observed_weight: number;
  grounded_tags: number;
  grounded_weight: number;
  coverage_pct: number | null;
}

export interface GapRow {
  node_id: string;
  code: string;
  label: string | null;
  branch: string;
  observed_sources: number;
  observed_weight: number;
  queued: boolean;
}

export interface QueueRow {
  id: string;
  taxonomy_code: string;
  source_url: string | null;
  storage_path: string | null;
  title: string | null;
  license: string;
  attribution: string;
  origin: string;
  status: string;
  notes: string | null;
  created_at: string;
}

export interface PackRow {
  id: string;
  name: string;
  version: string;
  kind: string;
  is_active: boolean;
  activated_at: string | null;
  code_count: number;
  created_at: string;
}

interface StatusPayload {
  coverage: CoverageRow[];
  coverage_pct: number;
  queue_counts: Record<string, number>;
  packs: PackRow[];
}

const call = async <T,>(body: Record<string, unknown>): Promise<T> => {
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token;
  const { data, error } = await supabase.functions.invoke("sound-curator", {
    body,
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  });
  if (error) throw new Error(error.message);
  const payload = data as { success?: boolean; error?: string } & T;
  if (payload?.success === false) throw new Error(payload.error ?? "Request failed");
  return payload as T;
};

export function useSoundLibrary() {
  const [status, setStatus] = useState<StatusPayload | null>(null);
  const [gaps, setGaps] = useState<GapRow[]>([]);
  const [queue, setQueue] = useState<QueueRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (branch: string | null = null) => {
    setLoading(true);
    try {
      const [st, gp, q] = await Promise.all([
        call<StatusPayload>({ action: "status" }),
        call<{ gaps: GapRow[] }>({ action: "gaps", limit: 40, branch }),
        supabase
          .from("grounding_queue")
          .select("id,taxonomy_code,source_url,storage_path,title,license,attribution,origin,status,notes,created_at")
          .in("status", ["pending", "proposed"])
          .order("created_at", { ascending: false })
          .limit(100),
      ]);
      setStatus(st);
      setGaps(gp.gaps ?? []);
      setQueue((q.data ?? []) as QueueRow[]);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load the Sound Library");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const run = useCallback(
    async (label: string, body: Record<string, unknown>) => {
      setBusy(label);
      try {
        const res = await call<Record<string, unknown>>(body);
        await load();
        setError(null);
        return res;
      } catch (e) {
        setError(e instanceof Error ? e.message : "Action failed");
        throw e;
      } finally {
        setBusy(null);
      }
    },
    [load],
  );

  /** Queue a clip an admin found themselves. License + attribution required. */
  const addToQueue = useCallback(
    async (row: {
      taxonomy_code: string;
      source_url: string;
      title?: string;
      license: string;
      attribution: string;
    }) => {
      const { data: sessionData } = await supabase.auth.getSession();
      const { error: insErr } = await supabase.from("grounding_queue").insert({
        ...row,
        origin: "manual",
        status: "pending",
        proposed_by: sessionData.session?.user.id ?? null,
      });
      if (insErr) throw new Error(insErr.message);
      await load();
    },
    [load],
  );

  return {
    status,
    gaps,
    queue,
    loading,
    busy,
    error,
    reload: load,
    addToQueue,
    autocurate: (branch: string | null) => run("autocurate", { action: "autocurate", branch }),
    approve: (queue_id: string) => run(`approve:${queue_id}`, { action: "approve", queue_id }),
    reject: (queue_id: string) => run(`reject:${queue_id}`, { action: "reject", queue_id }),
    publishPack: () => run("publish", { action: "publish_pack" }),
    activatePack: (pack_id: string) => run(`activate:${pack_id}`, { action: "activate_pack", pack_id }),
  };
}
