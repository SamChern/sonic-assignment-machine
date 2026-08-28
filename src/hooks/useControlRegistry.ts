import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export interface ControlBounds {
  min?: number;
  max?: number;
  step?: number;
  options?: unknown[];
}

export interface ControlKnob {
  key: string;
  value: unknown;
  value_type: "number" | "boolean" | "enum" | "json";
  bounds: ControlBounds | null;
  description: string | null;
  category: string;
  updated_at: string;
  updated_by: string | null;
}

export interface ControlAuditRow {
  id: number;
  key: string;
  old_value: unknown;
  new_value: unknown;
  changed_at: string;
}

/**
 * Admin-only reader/writer for `control_registry`. Every knob of the semantic
 * core is a row here: changing a value takes effect in the edge functions
 * within ~60s (their in-memory TTL cache), with no redeploy.
 */
export function useControlRegistry() {
  const [knobs, setKnobs] = useState<ControlKnob[]>([]);
  const [audit, setAudit] = useState<ControlAuditRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const [regRes, auditRes] = await Promise.all([
      supabase.from("control_registry").select("*").order("category").order("key"),
      supabase
        .from("control_audit")
        .select("id,key,old_value,new_value,changed_at")
        .order("changed_at", { ascending: false })
        .limit(200),
    ]);
    if (regRes.error) setError(regRes.error.message);
    else setError(null);
    setKnobs((regRes.data ?? []) as unknown as ControlKnob[]);
    setAudit((auditRes.data ?? []) as unknown as ControlAuditRow[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const setValue = useCallback(
    async (key: string, value: unknown) => {
      const { data: sessionData } = await supabase.auth.getSession();
      const { error: updErr } = await supabase
        .from("control_registry")
        // deno-lint-ignore no-explicit-any
        .update({ value: value as never, updated_by: sessionData.session?.user.id ?? null })
        .eq("key", key);
      if (updErr) throw new Error(updErr.message);
      await load();
    },
    [load],
  );

  /** One-click revert: restore the previous value recorded in the audit log. */
  const revert = useCallback(
    async (key: string) => {
      const { data, error: auditErr } = await supabase
        .from("control_audit")
        .select("old_value,new_value,changed_at")
        .eq("key", key)
        .order("changed_at", { ascending: false })
        .limit(1);
      if (auditErr) throw new Error(auditErr.message);
      const last = data?.[0];
      if (!last || last.old_value === null || last.old_value === undefined) {
        throw new Error("No previous value recorded for this control");
      }
      await setValue(key, last.old_value);
    },
    [setValue],
  );

  return { knobs, audit, loading, error, reload: load, setValue, revert };
}
