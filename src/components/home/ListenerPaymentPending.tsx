/**
 * The "payment coming soon" step. Shown to a Listener whose account exists but
 * whose $2.99 membership has not been paid yet, so their analyses stay locked.
 */
import { Clock, Lock } from "lucide-react";
import { Card } from "@/components/ui/card";

export const ListenerPaymentPending = ({ compact = false }: { compact?: boolean }) => (
  <Card
    className={`border-primary/30 bg-secondary/10 ${compact ? "p-4" : "p-6"}`}
    role="status"
    aria-live="polite"
  >
    <div className="flex items-start gap-3">
      <Lock className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
      <div>
        <h3 className="text-base font-semibold text-foreground">
          Your Listener membership is waiting on payment
        </h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Your account is set up and your place is held. Card payments open shortly — the moment
          your $2.99 a month membership is paid, your analyses unlock and everything you run is
          saved to your library.
        </p>
        <p className="mt-3 inline-flex items-center gap-2 text-xs font-medium text-primary">
          <Clock className="h-3.5 w-3.5" aria-hidden="true" />
          Payment coming soon — we&apos;ll email you at your sign-up address
        </p>
      </div>
    </div>
  </Card>
);

export default ListenerPaymentPending;
