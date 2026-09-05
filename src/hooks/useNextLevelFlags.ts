import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

/**
 * Batch E feature switches, read from `control_registry` (category `nextlevel`).
 *
 * The table is admin-readable only, so for everyone else every flag reads
 * `false` — which is exactly the intent: nothing below is exposed until an
 * admin flips it in the Control Room.
 */
export const NEXT_LEVEL_FLAGS = [
  "nextlevel.resonance_enabled",
  "nextlevel.commons_enabled",
  "nextlevel.ondevice_enabled",
  "nextlevel.hear_api_enabled",
  "nextlevel.frames_enabled",
  "nextlevel.passport_enabled",
  "nextlevel.sensory_enabled",
  "nextlevel.livecontext_enabled",
  "nextlevel.learning_public",
] as const;

export type NextLevelFlag = (typeof NEXT_LEVEL_FLAGS)[number];
export type NextLevelFlags = Record<NextLevelFlag, boolean>;

const allOff = (): NextLevelFlags =>
  NEXT_LEVEL_FLAGS.reduce((acc, k) => ({ ...acc, [k]: false }), {} as NextLevelFlags);

export function useNextLevelFlags() {
  const [flags, setFlags] = useState<NextLevelFlags>(allOff);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from("control_registry")
      .select("key,value")
      .in("key", NEXT_LEVEL_FLAGS as unknown as string[]);
    const next = allOff();
    for (const row of data ?? []) {
      if ((NEXT_LEVEL_FLAGS as readonly string[]).includes(row.key)) {
        next[row.key as NextLevelFlag] = row.value === true || row.value === "true";
      }
    }
    setFlags(next);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const setFlag = useCallback(
    async (key: NextLevelFlag, value: boolean) => {
      const { error } = await supabase
        .from("control_registry")
        .update({ value: value as unknown as never })
        .eq("key", key);
      if (error) throw error;
      setFlags((prev) => ({ ...prev, [key]: value }));
    },
    [],
  );

  return { flags, loading, reload: load, setFlag };
}
