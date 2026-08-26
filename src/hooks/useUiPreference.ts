import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

/**
 * Boolean UI preference persisted on the signed-in user's profile (`profiles.ui_prefs`)
 * so the choice follows them across devices and browsers. localStorage is kept as an
 * instant-paint cache and as the fallback for anonymous visitors.
 */
export const useUiPreference = (key: string, fallback = false) => {
  const storageKey = `sonicsim.ui.${key}`;
  const [value, setValue] = useState<boolean>(() => {
    try {
      const cached = localStorage.getItem(storageKey);
      return cached === null ? fallback : cached === "1";
    } catch {
      return fallback;
    }
  });
  const userId = useRef<string | null>(null);

  // Hydrate from the profile once the session is known.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const { data: auth } = await supabase.auth.getUser();
      const uid = auth.user?.id ?? null;
      userId.current = uid;
      if (!uid || cancelled) return;
      const { data } = await supabase
        .from("profiles")
        .select("ui_prefs")
        .eq("user_id", uid)
        .maybeSingle();
      const prefs = (data?.ui_prefs ?? {}) as Record<string, unknown>;
      if (!cancelled && typeof prefs[key] === "boolean") {
        setValue(prefs[key] as boolean);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [key]);

  const update = useCallback(
    (next: boolean) => {
      setValue(next);
      try {
        localStorage.setItem(storageKey, next ? "1" : "0");
      } catch {
        /* storage unavailable */
      }
      const uid = userId.current;
      if (!uid) return;
      void (async () => {
        const { data } = await supabase
          .from("profiles")
          .select("ui_prefs")
          .eq("user_id", uid)
          .maybeSingle();
        const prefs = { ...((data?.ui_prefs ?? {}) as Record<string, unknown>), [key]: next };
        await supabase.from("profiles").update({ ui_prefs: prefs }).eq("user_id", uid);
      })();
    },
    [key, storageKey],
  );

  return [value, update] as const;
};
