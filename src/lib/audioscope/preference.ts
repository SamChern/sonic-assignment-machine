/**
 * Persisted Audioscope Static/Play preference.
 *
 * Stored per browser profile in localStorage so a user's choice survives page
 * loads. When nothing is stored we fall back to the OS `prefers-reduced-motion`
 * setting, which means reduced-motion users start in Static by default.
 */

export type AudioscopeMotionPref = "static" | "motion";

export const prefersReducedMotion = (): boolean =>
  typeof window !== "undefined" &&
  Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches);

export const readMotionPref = (key: string): AudioscopeMotionPref | null => {
  if (typeof window === "undefined") return null;
  try {
    const v = window.localStorage.getItem(key);
    return v === "static" || v === "motion" ? v : null;
  } catch {
    return null;
  }
};

export const writeMotionPref = (key: string, pref: AudioscopeMotionPref): void => {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, pref);
  } catch {
    // Storage can be unavailable (private mode / quota) — preference is best-effort.
  }
};

/** Resolves the initial Static state: stored choice first, OS setting second. */
export const initialStatic = (key: string): boolean => {
  const stored = readMotionPref(key);
  if (stored) return stored === "static";
  return prefersReducedMotion();
};
