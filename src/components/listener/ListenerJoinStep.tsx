/**
 * Step 1 of the standalone Listener app: create an account with an email,
 * a password and an explicit agreement to the terms.
 */
import { useState } from "react";
import { toast } from "sonner";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { PENDING_KEY } from "@/hooks/useListenerSubscription";

const schema = z.object({
  email: z.string().trim().email("Enter a valid email address").max(255),
  password: z.string().min(6, "Use at least 6 characters"),
});

const ListenerJoinStep = ({ onSignedIn }: { onSignedIn: () => void }) => {
  const { signUp, signIn } = useAuth();
  const [mode, setMode] = useState<"join" | "signin">("join");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [terms, setTerms] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = schema.safeParse({ email, password });
    if (!parsed.success) {
      toast.error(parsed.error.errors[0].message);
      return;
    }
    setBusy(true);

    if (mode === "signin") {
      const { error } = await signIn(parsed.data.email, parsed.data.password);
      setBusy(false);
      if (error) {
        toast.error(error.message);
        return;
      }
      onSignedIn();
      return;
    }

    if (!terms) {
      setBusy(false);
      toast.error("Please accept the terms to continue.");
      return;
    }

    const { error } = await signUp(parsed.data.email, parsed.data.password, undefined, "/listen");
    if (error) {
      setBusy(false);
      toast.error(
        error.message.includes("already registered")
          ? "An account with this email already exists — sign in instead."
          : error.message,
      );
      return;
    }

    const { error: noticeError } = await supabase.functions.invoke("listener-signup", {
      body: {
        email: parsed.data.email,
        plan: "listener",
        terms_accepted: true,
        data_sharing_accepted: sharing,
      },
    });
    if (noticeError) console.warn("Sign-up notice failed", noticeError.message);

    localStorage.setItem(PENDING_KEY, JSON.stringify({ email: parsed.data.email, sharing }));
    setBusy(false);
    toast.success("Account created — check your email to confirm, then sign in here.");
    setMode("signin");
    setPassword("");
  };

  return (
    <Card className="space-y-4 p-4">
      <div>
        <h2 className="text-base font-semibold text-foreground">
          {mode === "join" ? "Create your Listener account" : "Sign in"}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {mode === "join"
            ? "Your email and your agreement to the terms are all we need to start."
            : "Welcome back — sign in to pick up where you left off."}
        </p>
      </div>

      <form onSubmit={submit} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="listen-email">Email</Label>
          <Input
            id="listen-email"
            type="email"
            inputMode="email"
            autoComplete="email"
            className="min-h-11"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="listen-password">Password</Label>
          <Input
            id="listen-password"
            type="password"
            autoComplete={mode === "join" ? "new-password" : "current-password"}
            className="min-h-11"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </div>

        {mode === "join" && (
          <>
            <div className="flex items-start gap-3">
              <Checkbox
                id="listen-terms"
                checked={terms}
                onCheckedChange={(v) => setTerms(v === true)}
              />
              <Label htmlFor="listen-terms" className="text-sm font-normal leading-snug">
                I accept the terms and conditions and the privacy policy.
              </Label>
            </div>
            <div className="flex items-start gap-3">
              <Checkbox
                id="listen-sharing"
                checked={sharing}
                onCheckedChange={(v) => setSharing(v === true)}
              />
              <Label htmlFor="listen-sharing" className="text-sm font-normal leading-snug">
                I&apos;m happy to share my results with the SonicSIM commons.
              </Label>
            </div>
          </>
        )}

        <Button type="submit" className="btn-teal-glow min-h-11 w-full" disabled={busy}>
          {busy
            ? "One moment…"
            : mode === "join"
              ? "Create my account"
              : "Sign in"}
        </Button>
      </form>

      <button
        type="button"
        className="w-full text-xs text-primary underline-offset-4 hover:underline"
        onClick={() => setMode(mode === "join" ? "signin" : "join")}
      >
        {mode === "join" ? "I already have an account" : "I need an account"}
      </button>
    </Card>
  );
};

export default ListenerJoinStep;
