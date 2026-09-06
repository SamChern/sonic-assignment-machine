/**
 * Open-web Creator application. Same look as the rest of the site: the plan
 * summary with the real pricing on the left, the application form on the right.
 */
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowLeft, Check, Palette } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";

const schema = z.object({
  contact_name: z.string().trim().min(2, "Enter your name").max(120),
  contact_email: z.string().trim().email("Enter a valid email address").max(255),
  org_name: z.string().trim().min(1, "Tell us your artist or label name").max(160),
});

const INCLUDED = [
  "Unlimited analyses across your own catalogue",
  "Originality and divergence against the wider market",
  "Lineage: what your work sounds close to, and what it doesn't",
  "Add work to the Sonic Commons with your licence terms and payout details",
];

const CreatorApply = () => {
  const navigate = useNavigate();
  const [form, setForm] = useState({
    contact_name: "",
    contact_email: "",
    org_name: "",
    website: "",
    catalogue_size: "",
    use_case: "",
  });
  const [terms, setTerms] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  const set = (key: keyof typeof form) => (value: string) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = schema.safeParse(form);
    if (!parsed.success) {
      toast.error(parsed.error.errors[0].message);
      return;
    }
    if (!terms) {
      toast.error("Please accept the terms to continue.");
      return;
    }

    setSubmitting(true);
    const { data, error } = await supabase.functions.invoke("access-application", {
      body: {
        kind: "creator",
        ...form,
        terms_accepted: true,
      },
    });
    setSubmitting(false);

    if (error || (data as { error?: string } | null)?.error) {
      toast.error("We couldn't send that. Please try again in a moment.");
      return;
    }
    setDone(true);
    toast.success("Application received — we'll be in touch by email.");
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
        <Button asChild variant="ghost" size="sm" className="mb-6 -ml-2">
          <Link to="/">
            <ArrowLeft className="mr-2 h-4 w-4" aria-hidden="true" />
            Back to home
          </Link>
        </Button>

        <div className="grid gap-6 lg:grid-cols-[1fr_1.2fr]">
          <Card className="h-fit border-primary/40 p-6 shadow-elegant">
            <div className="flex items-center gap-2">
              <Palette className="h-4 w-4 text-primary" aria-hidden="true" />
              <h2 className="text-lg font-semibold text-foreground">Creator</h2>
            </div>
            <p className="mt-2 text-sm text-muted-foreground">
              For artists and sound designers who want their work measured and credited.
            </p>
            <p className="mt-4 text-3xl font-bold text-foreground">$29.99/month</p>
            <p className="mt-1 text-xs text-muted-foreground">or $299.99 a year</p>
            <ul className="mt-6 space-y-2 border-t border-border/60 pt-4">
              {INCLUDED.map((item) => (
                <li key={item} className="flex gap-2 text-sm text-muted-foreground">
                  <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </Card>

          <Card className="p-6">
            <h1 className="text-xl font-bold tracking-tight text-foreground sm:text-2xl">
              Apply for creator access
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Tell us who you are and what you make. We review applications by hand and reply by
              email, usually within two working days.
            </p>

            {done ? (
              <div className="mt-6 space-y-4">
                <div className="rounded-xl bg-secondary/10 p-4">
                  <p className="text-sm font-medium text-foreground">Application received.</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    We'll email {form.contact_email} once your creator access is ready.
                  </p>
                </div>
                <Button onClick={() => navigate("/")} className="min-h-11 w-full">
                  Back to home
                </Button>
              </div>
            ) : (
              <form onSubmit={submit} className="mt-6 space-y-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="creator-name">Your name</Label>
                    <Input
                      id="creator-name"
                      value={form.contact_name}
                      onChange={(e) => set("contact_name")(e.target.value)}
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="creator-email">Email</Label>
                    <Input
                      id="creator-email"
                      type="email"
                      autoComplete="email"
                      placeholder="you@example.com"
                      value={form.contact_email}
                      onChange={(e) => set("contact_email")(e.target.value)}
                      required
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="creator-org">Artist, label or studio name</Label>
                  <Input
                    id="creator-org"
                    value={form.org_name}
                    onChange={(e) => set("org_name")(e.target.value)}
                    required
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="creator-links">Where can we hear your work?</Label>
                  <Input
                    id="creator-links"
                    placeholder="Streaming profile, website or a link to a few tracks"
                    value={form.website}
                    onChange={(e) => set("website")(e.target.value)}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="creator-catalogue">How much work would you bring?</Label>
                  <Select
                    value={form.catalogue_size}
                    onValueChange={(v) => set("catalogue_size")(v)}
                  >
                    <SelectTrigger id="creator-catalogue">
                      <SelectValue placeholder="Choose a range" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="1-10 tracks">1–10 tracks</SelectItem>
                      <SelectItem value="11-50 tracks">11–50 tracks</SelectItem>
                      <SelectItem value="51-250 tracks">51–250 tracks</SelectItem>
                      <SelectItem value="250+ tracks">250+ tracks</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="creator-use">What do you want out of it?</Label>
                  <Textarea
                    id="creator-use"
                    rows={4}
                    placeholder="For example: understand how my sound differs from the market, or licence my work for machine use."
                    value={form.use_case}
                    onChange={(e) => set("use_case")(e.target.value)}
                  />
                </div>

                <div className="flex items-start gap-3">
                  <Checkbox
                    id="creator-terms"
                    checked={terms}
                    onCheckedChange={(v) => setTerms(v === true)}
                  />
                  <Label htmlFor="creator-terms" className="text-sm font-normal leading-snug">
                    I hold the rights to the work I submit, and I accept the terms and conditions
                    and the privacy policy.
                  </Label>
                </div>

                <Button
                  type="submit"
                  className="btn-teal-glow min-h-11 w-full"
                  disabled={submitting}
                >
                  {submitting ? "Sending your application…" : "Send application"}
                </Button>
              </form>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
};

export default CreatorApply;
