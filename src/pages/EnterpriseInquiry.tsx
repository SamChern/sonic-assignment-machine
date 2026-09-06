/**
 * Open-web Enterprise demo inquiry. Mirrors the Creator application layout:
 * plan summary with the real pricing label on the left, the inquiry form on the
 * right. Signed-in enterprise accounts track their requests under /admin.
 */
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowLeft, Building2, Check } from "lucide-react";
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
  contact_email: z.string().trim().email("Enter a valid work email address").max(255),
  org_name: z.string().trim().min(1, "Tell us your company name").max(160),
});

const INCLUDED = [
  "Audience cohorts built from sonic behaviour, not guesses",
  "Predicted reach and match strength before you spend",
  "Connected data sources and audience activations",
  "Access controls, audit history and support",
];

const EnterpriseInquiry = () => {
  const navigate = useNavigate();
  const [form, setForm] = useState({
    contact_name: "",
    contact_email: "",
    org_name: "",
    website: "",
    team_size: "",
    use_case: "",
    preferred_timing: "",
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
      body: { kind: "enterprise", ...form, terms_accepted: true },
    });
    setSubmitting(false);

    if (error || (data as { error?: string } | null)?.error) {
      toast.error("We couldn't send that. Please try again in a moment.");
      return;
    }
    setDone(true);
    toast.success("Inquiry received — we'll be in touch to arrange your demo.");
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
          <Card className="h-fit border-border/60 p-6">
            <div className="flex items-center gap-2">
              <Building2 className="h-4 w-4 text-primary" aria-hidden="true" />
              <h2 className="text-lg font-semibold text-foreground">Enterprise</h2>
            </div>
            <p className="mt-2 text-sm text-muted-foreground">
              For teams using sound to understand and reach real audiences.
            </p>
            <p className="mt-4 text-xl font-bold text-foreground">
              Inquire for demo and pricing
            </p>
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
              Inquire for demo and pricing
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Tell us about your team and what you want to reach. We'll reply with a walkthrough
              time and pricing for your size.
            </p>

            {done ? (
              <div className="mt-6 space-y-4">
                <div className="rounded-xl bg-secondary/10 p-4">
                  <p className="text-sm font-medium text-foreground">Inquiry received.</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    We'll email {form.contact_email} to arrange your demo.
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
                    <Label htmlFor="ent-name">Your name</Label>
                    <Input
                      id="ent-name"
                      value={form.contact_name}
                      onChange={(e) => set("contact_name")(e.target.value)}
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="ent-email">Work email</Label>
                    <Input
                      id="ent-email"
                      type="email"
                      autoComplete="email"
                      placeholder="you@company.com"
                      value={form.contact_email}
                      onChange={(e) => set("contact_email")(e.target.value)}
                      required
                    />
                  </div>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="ent-org">Company</Label>
                    <Input
                      id="ent-org"
                      value={form.org_name}
                      onChange={(e) => set("org_name")(e.target.value)}
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="ent-team">Team size</Label>
                    <Select value={form.team_size} onValueChange={(v) => set("team_size")(v)}>
                      <SelectTrigger id="ent-team">
                        <SelectValue placeholder="Choose a range" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="1-10">1–10 people</SelectItem>
                        <SelectItem value="11-50">11–50 people</SelectItem>
                        <SelectItem value="51-250">51–250 people</SelectItem>
                        <SelectItem value="250+">250+ people</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="ent-site">Company website</Label>
                  <Input
                    id="ent-site"
                    placeholder="company.com"
                    value={form.website}
                    onChange={(e) => set("website")(e.target.value)}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="ent-use">What would you use it for?</Label>
                  <Textarea
                    id="ent-use"
                    rows={4}
                    placeholder="For example: find audiences for a campaign, or check how our sound lands before we spend."
                    value={form.use_case}
                    onChange={(e) => set("use_case")(e.target.value)}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="ent-timing">When suits you for a walkthrough?</Label>
                  <Input
                    id="ent-timing"
                    placeholder="For example: weekday mornings, UK time"
                    value={form.preferred_timing}
                    onChange={(e) => set("preferred_timing")(e.target.value)}
                  />
                </div>

                <div className="flex items-start gap-3">
                  <Checkbox
                    id="ent-terms"
                    checked={terms}
                    onCheckedChange={(v) => setTerms(v === true)}
                  />
                  <Label htmlFor="ent-terms" className="text-sm font-normal leading-snug">
                    I accept the terms and conditions and the privacy policy.
                  </Label>
                </div>

                <Button
                  type="submit"
                  className="btn-teal-glow min-h-11 w-full"
                  disabled={submitting}
                >
                  {submitting ? "Sending your inquiry…" : "Send inquiry"}
                </Button>
              </form>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
};

export default EnterpriseInquiry;
