/**
 * Step 16.0 — the persona (door) preference.
 *
 * A persona is a *view* preference and never a permission: permissions stay on
 * `app_role` / `org_role`. Signed-in users persist it on `profiles.persona`;
 * guests keep it in localStorage so the first-visit question is asked once.
 */
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

export type Persona = "curious" | "marketing" | "creator";

export const PERSONAS: Array<{
  value: Persona;
  label: string;
  blurb: string;
  path: string;
}> = [
  {
    value: "curious",
    label: "I'm curious",
    blurb: "Hear what one piece of audio says about you.",
    path: "/?tab=listen",
  },
  {
    value: "marketing",
    label: "I run marketing",
    blurb: "Find audiences, predict performance, activate segments.",
    path: "/workspace",
  },
  {
    value: "creator",
    label: "I make things",
    blurb: "Fingerprint your work and see its lineage.",
    path: "/?tab=library",
  },
];

const LS_KEY = "sonicsim.persona";

const isPersona = (v: unknown): v is Persona =>
  v === "curious" || v === "marketing" || v === "creator";

const readLocal = (): Persona | null => {
  try {
    const v = localStorage.getItem(LS_KEY);
    return isPersona(v) ? v : null;
  } catch {
    return null;
  }
};

export function usePersona() {
  const { user, loading: authLoading } = useAuth();
  const [persona, setPersonaState] = useState<Persona | null>(() => readLocal());
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (authLoading) return;
    let cancelled = false;

    (async () => {
      if (!user) {
        if (!cancelled) {
          setPersonaState(readLocal());
          setReady(true);
        }
        return;
      }
      try {
        const { data } = await supabase
          .from("profiles")
          .select("persona")
          .eq("user_id", user.id)
          .maybeSingle();
        if (cancelled) return;
        const remote = isPersona(data?.persona) ? (data!.persona as Persona) : null;
        const local = readLocal();
        if (remote) {
          setPersonaState(remote);
          try {
            localStorage.setItem(LS_KEY, remote);
          } catch {
            /* ignore */
          }
        } else if (local) {
          // Carry a guest choice into the account on first sign-in.
          setPersonaState(local);
          await supabase.from("profiles").update({ persona: local }).eq("user_id", user.id);
        } else {
          setPersonaState(null);
        }
      } catch (err) {
        // A failed profile read must never wedge the app behind `ready === false`:
        // fall back to whatever the guest choice was.
        console.error("persona load failed", err);
        if (!cancelled) setPersonaState(readLocal());
      } finally {
        if (!cancelled) setReady(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [user, authLoading]);

  const setPersona = useCallback(
    async (next: Persona) => {
      setPersonaState(next);
      try {
        localStorage.setItem(LS_KEY, next);
      } catch {
        /* ignore */
      }
      if (user) {
        // The local choice already applied; a failed write just means it is not
        // yet durable, so it must not throw into the caller's click handler.
        const { error } = await supabase
          .from("profiles")
          .update({ persona: next })
          .eq("user_id", user.id);
        if (error) console.error("persona save failed", error);
      }
    },
    [user],
  );

  return { persona, setPersona, ready };
}
