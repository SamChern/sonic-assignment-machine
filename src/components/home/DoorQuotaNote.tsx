/**
 * The one-line note under the listen controls: how many analyses are left, or
 * why they are locked.
 */
import { Link } from "react-router-dom";

export const DoorQuotaNote = ({
  awaitingPayment,
  quotaExhausted,
  isSignedIn,
  remaining,
  monthlyLimit,
}: {
  awaitingPayment: boolean;
  quotaExhausted: boolean;
  isSignedIn: boolean;
  remaining: number;
  monthlyLimit: number;
}) => (
  <p className="mt-3 text-xs text-muted-foreground">
    {awaitingPayment ? (
      <>Your analyses unlock as soon as your $2.99 membership payment goes through.</>
    ) : quotaExhausted ? (
      isSignedIn ? (
        <>
          You&apos;ve used your {monthlyLimit} free analyses this month.{" "}
          <Link to="/workspace" className="text-primary underline-offset-4 hover:underline">
            See what this does at scale
          </Link>
          .
        </>
      ) : (
        <>
          That was your free look.{" "}
          <Link to="/auth" className="text-primary underline-offset-4 hover:underline">
            Create a free account
          </Link>{" "}
          to save, share, and run {monthlyLimit} a month.
        </>
      )
    ) : (
      <>
        {remaining} free {remaining === 1 ? "analysis" : "analyses"} left
        {isSignedIn ? " this month" : " — no signup needed"}.
      </>
    )}
  </p>
);

export default DoorQuotaNote;
