import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Loader2, Send } from "lucide-react";
import { toast } from "sonner";
import type { NewDemoRequest } from "@/hooks/useDemoRequests";

interface Props {
  busy: boolean;
  defaultEmail?: string;
  onSubmit: (input: NewDemoRequest) => Promise<{ ok: boolean; message: string }>;
}

/** Form an enterprise account fills in to ask for a demo. */
export const DemoRequestForm = ({ busy, defaultEmail, onSubmit }: Props) => {
  const [company, setCompany] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState(defaultEmail ?? "");
  const [phone, setPhone] = useState("");
  const [teamSize, setTeamSize] = useState("");
  const [useCase, setUseCase] = useState("");
  const [timing, setTiming] = useState("");

  const canSend =
    company.trim().length > 1 &&
    name.trim().length > 1 &&
    /.+@.+\..+/.test(email.trim()) &&
    useCase.trim().length > 9;

  const submit = async () => {
    const result = await onSubmit({
      company_name: company,
      contact_name: name,
      contact_email: email,
      contact_phone: phone,
      team_size: teamSize,
      use_case: useCase,
      preferred_timing: timing,
    });
    if (result.ok) {
      toast.success("Demo request sent — we'll be in touch.");
      setCompany("");
      setName("");
      setPhone("");
      setTeamSize("");
      setUseCase("");
      setTiming("");
    } else {
      toast.error(result.message);
    }
  };

  return (
    <Card className="p-6">
      <h2 className="text-lg font-semibold text-foreground">Request a demo</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Tell us who you are and what you want to see. We reply by email and you can follow the
        status of your request on this page.
      </p>

      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="demo-company">Company</Label>
          <Input
            id="demo-company"
            value={company}
            onChange={(event) => setCompany(event.target.value)}
            placeholder="Company name"
            className="mt-1"
          />
        </div>
        <div>
          <Label htmlFor="demo-name">Your name</Label>
          <Input
            id="demo-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Full name"
            className="mt-1"
          />
        </div>
        <div>
          <Label htmlFor="demo-email">Email</Label>
          <Input
            id="demo-email"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="you@company.com"
            className="mt-1"
          />
        </div>
        <div>
          <Label htmlFor="demo-phone">Phone (optional)</Label>
          <Input
            id="demo-phone"
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
            placeholder="+1…"
            className="mt-1"
          />
        </div>
        <div>
          <Label htmlFor="demo-team">Team size (optional)</Label>
          <Input
            id="demo-team"
            value={teamSize}
            onChange={(event) => setTeamSize(event.target.value)}
            placeholder="e.g. 12"
            className="mt-1"
          />
        </div>
        <div>
          <Label htmlFor="demo-timing">Preferred timing (optional)</Label>
          <Input
            id="demo-timing"
            value={timing}
            onChange={(event) => setTiming(event.target.value)}
            placeholder="e.g. weekday mornings, UK time"
            className="mt-1"
          />
        </div>
      </div>

      <div className="mt-4">
        <Label htmlFor="demo-use-case">What do you want to see?</Label>
        <Textarea
          id="demo-use-case"
          value={useCase}
          onChange={(event) => setUseCase(event.target.value)}
          placeholder="Audiences we want to reach, the sound we work with, and what a good result looks like."
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
        Send request
      </Button>
    </Card>
  );
};

export default DemoRequestForm;
