/**
 * Step 2 of the standalone Listener app: choose monthly or yearly membership.
 * Card payments are not open yet, so choosing holds the person's place and
 * keeps their analyses locked until the membership is paid.
 */
import { useState } from "react";
import { Check, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import ListenerPaymentPending from "@/components/home/ListenerPaymentPending";

type Period = "monthly" | "annual";

const OPTIONS: { id: Period; price: string; caption: string; note?: string }[] = [
  { id: "monthly", price: "$2.99", caption: "a month", note: "Cancel any time" },
  { id: "annual", price: "$29.99", caption: "a year", note: "Two months free" },
];

interface Props {
  email: string | null;
  awaitingPayment: boolean;
  onChoose: (period: Period) => Promise<void>;
}

const ListenerPlanStep = ({ email, awaitingPayment, onChoose }: Props) => {
  const [period, setPeriod] = useState<Period>("monthly");
  const [busy, setBusy] = useState(false);

  if (awaitingPayment) return <ListenerPaymentPending />;

  const confirm = async () => {
    setBusy(true);
    try {
      await onChoose(period);
      toast.success("Your place is held. We'll email you the moment payment opens.");
    } catch {
      toast.error("We couldn't hold your place just now. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="space-y-4 p-4">
      <div>
        <h2 className="text-base font-semibold text-foreground">Choose your membership</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Unlimited readings of your own sounds, saved to your private library.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {OPTIONS.map((o) => {
          const active = period === o.id;
          return (
            <button
              key={o.id}
              type="button"
              onClick={() => setPeriod(o.id)}
              aria-pressed={active}
              className={`rounded-lg border p-4 text-left transition ${
                active
                  ? "border-primary bg-primary/10 shadow-sm"
                  : "border-border/60 bg-card/60 hover:border-primary/40"
              }`}
            >
              <div className="flex items-center gap-2">
                <span className="text-xl font-semibold text-foreground">{o.price}</span>
                <span className="text-xs text-muted-foreground">{o.caption}</span>
                {active && <Check className="ml-auto h-4 w-4 text-primary" aria-hidden="true" />}
              </div>
              {o.note && <p className="mt-1 text-xs text-muted-foreground">{o.note}</p>}
            </button>
          );
        })}
      </div>

      <Button className="btn-teal-glow min-h-11 w-full" onClick={() => void confirm()} disabled={busy}>
        {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
        Continue
      </Button>

      <p className="text-xs text-muted-foreground">
        Card payments open shortly. {email ? `We'll email ${email}` : "We'll email you"} as soon as
        you can pay, and your readings unlock straight away.
      </p>
    </Card>
  );
};

export default ListenerPlanStep;
