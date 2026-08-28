import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

/** Namespaced localStorage key for a preference — the instant-paint cache. */
const cacheKey = (key: string) => `sonicsim.ui.${key}`;

const readCache = (key: string): string | null => {
  try {
    return localStorage.getItem(cacheKey(key));
  } catch {
    return null;
  }
};

const writeCache = (key: string, raw: string) => {
  try {
    localStorage.setItem(cacheKey(key), raw);
  } catch {
    /* storage unavailable (private mode, quota) — the profile still holds it */
  }
};

/**
 * Merge one key into the signed-in user's `profiles.ui_prefs` without clobbering
 * the preferences other devices have written.
 */
const persistToProfile = async (uid: string, key: string, value: unknown) => {
  const { data } = await supabase
    .from("profiles")
    .select("ui_prefs")
    .eq("user_id", uid)
    .maybeSingle();
  const prefs = { ...((data?.ui_prefs ?? {}) as Record<string, unknown>), [key]: value };
  await supabase
    .from("profiles")
    .update({ ui_prefs: prefs as Record<string, never> })
    .eq("user_id", uid);
};

/**
 * Any JSON-serializable UI preference, persisted on the signed-in user's profile
 * so a choice made on a laptop is already made on their phone. localStorage stays
 * in the loop purely as an instant-paint cache and as the store for anonymous
 * visitors, who have no profile to sync to.
 *
 * `validate` guards against stale cached values after a refactor renames a tab or
 * drops an option: anything it rejects falls back to `fallback`.
 */
export const useUiPreferenceValue = <T,>(
  key: string,
  fallback: T,
  validate?: (value: unknown) => boolean,
) => {
  const check = useCallback(
    (value: unknown): value is T => (validate ? validate(value) : value !== undefined),
    [validate],
  );

  const [value, setValue] = useState<T>(() => {
    const cached = readCache(key);
    if (cached === null) return fallback;
    try {
      const parsed = JSON.parse(cached) as unknown;
      return check(parsed) ? parsed : fallback;
    } catch {
      // Legacy plain-string values written before this hook existed.
      return check(cached) ? (cached as T) : fallback;
    }
  });

  const userId = useRef<string | null>(null);
  /** True once a local edit has happened, so late hydration never overwrites it. */
  const dirty = useRef(false);

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
      if (cancelled || dirty.current) return;
      const remote = prefs[key];
      if (remote !== undefined && check(remote)) setValue(remote);
    })();
    return () => {
      cancelled = true;
    };
  }, [key, check]);

  const update = useCallback(
    (next: T) => {
      dirty.current = true;
      setValue(next);
      writeCache(key, JSON.stringify(next));
      const uid = userId.current;
      if (uid) void persistToProfile(uid, key, next);
    },
    [key],
  );

  return [value, update] as const;
};

/**
 * Boolean convenience wrapper, kept for the many collapse/expand toggles that
 * already use it. Reads legacy `"1"`/`"0"` cache values written before the JSON
 * variant landed.
 */
export const useUiPreference = (key: string, fallback = false) => {
  const validate = useMemo(() => (v: unknown) => typeof v === "boolean", []);
  const [value, update] = useUiPreferenceValue<boolean>(
    key,
    (() => {
      const cached = readCache(key);
      if (cached === "1") return true;
      if (cached === "0") return false;
      return fallback;
    })(),
    validate,
  );
  return [value, update] as const;
};
