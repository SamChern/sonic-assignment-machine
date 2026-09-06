/**
 * Reads the signed-in person's Listener membership. People who never signed up
 * as a Listener (admins, creators, enterprise members) have no record and are
 * never gated by this hook.
 */
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export const PENDING_KEY = "sonicsim_listener_pending";

export type ListenerMembership = {
  id: string;
  status: "awaiting_payment" | "active" | "cancelled";
  plan: string;
  price_cents: number;
  activated_at: string | null;
};

export const useListenerSubscription = (userId: string | null) => {
  const [membership, setMembership] = useState<ListenerMembership | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!userId) {
      setMembership(null);
      return;
    }
    setLoading(true);
    const { data, error: err } = await supabase
      .from("listener_subscriptions")
      .select("id, status, plan, price_cents, activated_at")
      .eq("user_id", userId)
      .maybeSingle();
    setLoading(false);
    if (err) {
      // An unreadable membership must never look like "not paid".
      console.error("membership lookup failed", err);
      setError("We couldn't check your membership just now.");
      setMembership(null);
      return;
    }
    setError(null);
    setMembership((data as ListenerMembership | null) ?? null);
  }, [userId]);

  useEffect(() => {
    void load();
  }, [load]);

  // A visitor who signed up as a Listener may only be able to sign in later, so
  // their pending membership is recorded on their first signed-in visit.
  useEffect(() => {
    if (!userId || loading || membership) return;
    const pending = localStorage.getItem(PENDING_KEY);
    if (!pending) return;
    let sharing = false;
    let email: string | null = null;
    try {
      const parsed = JSON.parse(pending) as { email?: string; sharing?: boolean };
      sharing = parsed.sharing === true;
      email = parsed.email ?? null;
    } catch {
      /* a malformed flag is simply ignored */
    }
    void (async () => {
      await claimPending(email, sharing);
      localStorage.removeItem(PENDING_KEY);
    })();
  }, [userId, loading, membership, claimPending]);

  /** Records a pending Listener membership for the person who just signed in. */
  const claimPending = useCallback(
    async (email: string | null, dataSharing: boolean) => {
      if (!userId) return;
      const { error: err } = await supabase.from("listener_subscriptions").insert({
        user_id: userId,
        email,
        plan: "listener",
        status: "awaiting_payment",
        terms_accepted: true,
        data_sharing_accepted: dataSharing,
      });
      if (err && !err.message.includes("duplicate")) {
        console.warn("membership record failed", err.message);
      }
      await load();
    },
    [userId, load],
  );

  return {
    membership,
    loading,
    error,
    reload: load,
    claimPending,
    awaitingPayment: membership?.status === "awaiting_payment",
    isActive: membership?.status === "active",
  };
};

export default useListenerSubscription;
