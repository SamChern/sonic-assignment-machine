import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, Send } from "lucide-react";
import type { NewCreatorApplication } from "@/hooks/useCreatorApplications";

interface Props {
  busy: boolean;
  defaultEmail?: string;
  onSubmit: (input: NewCreatorApplication) => Promise<{ ok: boolean; message: string }>;
}

/** The Creator application: who you are, your work, and what you want from it. */
const CreatorApplicationForm = ({ busy, defaultEmail, onSubmit }: Props) => {
  const [name, setName] = useState("");
  const [email, setEmail] = useState(defaultEmail ?? "");
  const [orgName, setOrgName] = useState("");
  const [website, setWebsite] = useState("");
  const [catalogueSize, setCatalogueSize] = useState("");
  const [useCase, setUseCase] = useState("");

  const canSend =
    name.trim().length > 1 &&
    orgName.trim().length > 0 &&
    /.+@.+\..+/.test(email.trim()) &&
    useCase.trim().length > 9;

  const submit = async () => {
    const result = await onSubmit({
      contact_name: name,
      contact_email: email,
      org_name: orgName,
      website,
      catalogue_size: catalogueSize,
      use_case: useCase,
    });
    if (result.ok) {
      toast.success("Application sent — we'll be in touch by email.");
      setName("");
      setOrgName("");
      setWebsite("");
      setCatalogueSize("");
      setUseCase("");
    } else {
      toast.error(result.message);
    }
  };

  return (
    <Card className="p-6">
      <h2 className="text-lg font-semibold text-foreground">Apply as a Creator</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        $29.99 a month, or $299.99 a year. Tell us about your work and we&apos;ll review it — you
        can follow the outcome on this page.
      </p>

      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="creator-name">Your name</Label>
          <Input
            id="creator-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Full name"
            className="mt-1"
          />
        </div>
        <div>
          <Label htmlFor="creator-org">Artist or label name</Label>
          <Input
            id="creator-org"
            value={orgName}
            onChange={(event) => setOrgName(event.target.value)}
            placeholder="How your work is credited"
            className="mt-1"
          />
        </div>
        <div>
          <Label htmlFor="creator-email">Email</Label>
          <Input
            id="creator-email"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="you@example.com"
            className="mt-1"
          />
        </div>
        <div>
          <Label htmlFor="creator-website">Website or profile (optional)</Label>
          <Input
            id="creator-website"
            value={website}
            onChange={(event) => setWebsite(event.target.value)}
            placeholder="https://…"
            className="mt-1"
          />
        </div>
        <div className="sm:col-span-2">
          <Label htmlFor="creator-catalogue">How much work do you have? (optional)</Label>
          <Input
            id="creator-catalogue"
            value={catalogueSize}
            onChange={(event) => setCatalogueSize(event.target.value)}
            placeholder="e.g. 40 released tracks, plus demos"
            className="mt-1"
          />
        </div>
      </div>

      <div className="mt-4">
        <Label htmlFor="creator-use-case">What do you want to find out?</Label>
        <Textarea
          id="creator-use-case"
          value={useCase}
          onChange={(event) => setUseCase(event.target.value)}
          placeholder="The sound you work with, the audience you're trying to reach, and what a good result looks like."
          rows={4}
          className="mt-1"
        />
      </div>

      <Button
        onClick={submit}
        disabled={!canSend || busy}
        className="mt-5 min-h-11 w-full sm:w-auto"
      >
        {busy ? (
          <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
        ) : (
          <Send className="mr-2 h-4 w-4" aria-hidden="true" />
        )}
        Send application
      </Button>
    </Card>
  );
};

export default CreatorApplicationForm;
