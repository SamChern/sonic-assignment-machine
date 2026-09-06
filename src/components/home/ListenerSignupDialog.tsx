/**
 * Listener sign-up: email, password and an explicit terms + data-sharing
 * consent. Creates a real account and records the consent, then tells the
 * SonicSIM inbox a new listener has joined.
 */
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";

const schema = z.object({
  email: z.string().trim().email("Enter a valid email address").max(255),
  password: z.string().min(6, "Use at least 6 characters"),
});

export const ListenerSignupDialog = ({
  triggerLabel,
  triggerVariant = "outline",
}: {
  triggerLabel: string;
  triggerVariant?: "default" | "outline";
}) => {
  const navigate = useNavigate();
  const { signUp } = useAuth();
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [terms, setTerms] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = schema.safeParse({ email, password });
    if (!parsed.success) {
      toast.error(parsed.error.errors[0].message);
      return;
    }
    if (!terms) {
      toast.error("Please accept the terms to continue.");
      return;
    }

    setSubmitting(true);
    const { error } = await signUp(parsed.data.email, parsed.data.password, undefined, "/");
    if (error) {
      setSubmitting(false);
      toast.error(
        error.message.includes("already registered")
          ? "An account with this email already exists — sign in instead."
          : error.message,
      );
      return;
    }

    // Record the consent and notify the SonicSIM inbox. A failure here must not
    // block the person who has just signed up.
    const { error: recordError } = await supabase.functions.invoke("listener-signup", {
      body: {
        email: parsed.data.email,
        plan: "listener",
        terms_accepted: true,
        data_sharing_accepted: sharing,
      },
    });
    if (recordError) console.warn("Sign-up notice failed", recordError.message);

    setSubmitting(false);
    setOpen(false);
    toast.success("Account created — check your email to confirm, then sign in.");
    navigate("/auth");
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant={triggerVariant} className="w-full min-h-11">
          {triggerLabel}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Create your Listener account</DialogTitle>
          <DialogDescription>
            Your email and your agreement to the terms are all we need to get started.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="listener-email">Email</Label>
            <Input
              id="listener-email"
              type="email"
              autoComplete="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="listener-password">Password</Label>
            <Input
              id="listener-password"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>
          <div className="flex items-start gap-3">
            <Checkbox
              id="listener-terms"
              checked={terms}
              onCheckedChange={(v) => setTerms(v === true)}
            />
            <Label htmlFor="listener-terms" className="text-sm font-normal leading-snug">
              I accept the terms and conditions and the privacy policy.
            </Label>
          </div>
          <div className="flex items-start gap-3">
            <Checkbox
              id="listener-sharing"
              checked={sharing}
              onCheckedChange={(v) => setSharing(v === true)}
            />
            <Label htmlFor="listener-sharing" className="text-sm font-normal leading-snug">
              I agree to share my analysis data with the SonicSIM commons.
            </Label>
          </div>
          <DialogFooter>
            <Button type="submit" className="w-full btn-teal-glow" disabled={submitting}>
              {submitting ? "Creating your account…" : "Create account"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};

export default ListenerSignupDialog;
