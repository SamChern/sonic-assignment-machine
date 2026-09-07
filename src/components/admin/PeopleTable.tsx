import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { ConfirmAction } from "@/components/ConfirmAction";
import type {
  AdminPerson,
  BillingPeriod,
  MembershipStatus,
} from "@/hooks/useAdminPeople";

const statusTone = (status: string | null) => {
  switch (status) {
    case "active":
      return "border-emerald-500/40 text-emerald-500";
    case "awaiting_payment":
      return "border-primary/40 text-primary";
    case "cancelled":
      return "border-destructive/40 text-destructive";
    default:
      return "border-border text-muted-foreground";
  }
};

const statusLabel = (status: string | null) => {
  switch (status) {
    case "active":
      return "Paid member";
    case "awaiting_payment":
      return "Waiting on payment";
    case "cancelled":
      return "Cancelled";
    default:
      return "Free trial";
  }
};

interface Props {
  people: AdminPerson[];
  busy: boolean;
  onMembership: (
    userId: string,
    status: MembershipStatus,
    billing: BillingPeriod,
  ) => Promise<{ ok: boolean; message: string }>;
  onRole: (
    userId: string,
    role: "admin" | "moderator",
    grant: boolean,
  ) => Promise<{ ok: boolean; message: string }>;
}

/** One row per account: who they are, what they pay for, what they can reach. */
export const PeopleTable = ({ people, busy, onMembership, onRole }: Props) => {
  const run = async (action: Promise<{ ok: boolean; message: string }>) => {
    const result = await action;
    if (result.ok) toast.success(result.message);
    else toast.error(result.message);
  };

  if (people.length === 0) {
    return <Card className="p-6 text-sm text-muted-foreground">No accounts match.</Card>;
  }

  return (
    <div className="space-y-3">
      {people.map((person) => {
        const billing = (person.billing_period === "annual" ? "annual" : "monthly") as BillingPeriod;
        const isAdmin = person.roles.includes("admin");
        const isModerator = person.roles.includes("moderator");
        return (
          <Card key={person.user_id} className="p-4 sm:p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <h3 className="truncate text-base font-semibold text-foreground">
                  {person.username || person.email || "Unnamed account"}
                </h3>
                <p className="truncate text-sm text-muted-foreground">{person.email}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Joined{" "}
                  {person.signed_up_at
                    ? new Date(person.signed_up_at).toLocaleDateString()
                    : "—"}
                  {" · "}
                  {person.analyses_count.toLocaleString()} saved{" "}
                  {person.analyses_count === 1 ? "analysis" : "analyses"}
                  {person.last_sign_in_at
                    ? ` · last seen ${new Date(person.last_sign_in_at).toLocaleDateString()}`
                    : ""}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                <Badge variant="outline" className={statusTone(person.membership_status)}>
                  {statusLabel(person.membership_status)}
                </Badge>
                {person.membership_status && (
                  <Badge variant="outline" className="border-border text-muted-foreground">
                    {billing === "annual" ? "$29.99 a year" : "$2.99 a month"}
                  </Badge>
                )}
                {isAdmin && (
                  <Badge variant="outline" className="border-primary/40 text-primary">
                    admin
                  </Badge>
                )}
                {isModerator && (
                  <Badge variant="outline" className="border-border text-muted-foreground">
                    moderator
                  </Badge>
                )}
                {person.creator_status && (
                  <Badge variant="outline" className="border-border text-muted-foreground">
                    creator: {person.creator_status}
                  </Badge>
                )}
              </div>
            </div>

            <div className="mt-4 flex flex-wrap items-end gap-2">
              <div className="w-40">
                <label
                  className="text-xs text-muted-foreground"
                  htmlFor={`plan-${person.user_id}`}
                >
                  Plan
                </label>
                <Select
                  value={billing}
                  onValueChange={(value) =>
                    void run(
                      onMembership(
                        person.user_id,
                        (person.membership_status as MembershipStatus) ?? "active",
                        value as BillingPeriod,
                      ),
                    )
                  }
                >
                  <SelectTrigger id={`plan-${person.user_id}`} className="mt-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="monthly">Listener · $2.99 a month</SelectItem>
                    <SelectItem value="annual">Listener · $29.99 a year</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <Button
                size="sm"
                disabled={busy || person.membership_status === "active"}
                onClick={() => void run(onMembership(person.user_id, "active", billing))}
              >
                Upgrade to paid
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={busy || person.membership_status === "awaiting_payment"}
                onClick={() =>
                  void run(onMembership(person.user_id, "awaiting_payment", billing))
                }
              >
                Hold for payment
              </Button>
              {person.membership_status && person.membership_status !== "cancelled" && (
                <ConfirmAction
                  title="Cancel this membership?"
                  description={`${person.email ?? "This account"} loses paid access and goes back to the free trial limits.`}
                  confirmLabel="Yes, cancel it"
                  cancelLabel="Keep it"
                  onConfirm={() =>
                    run(onMembership(person.user_id, "cancelled", billing))
                  }
                  trigger={
                    <Button size="sm" variant="ghost" className="text-destructive">
                      Cancel membership
                    </Button>
                  }
                />
              )}

              <span className="mx-1 hidden h-6 w-px bg-border sm:block" aria-hidden="true" />

              {isAdmin ? (
                <ConfirmAction
                  title="Remove admin access?"
                  description={`${person.email ?? "This account"} loses every admin screen and control.`}
                  onConfirm={() => run(onRole(person.user_id, "admin", false))}
                  trigger={
                    <Button size="sm" variant="ghost" className="text-destructive">
                      Remove admin
                    </Button>
                  }
                />
              ) : (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() => void run(onRole(person.user_id, "admin", true))}
                >
                  Make admin
                </Button>
              )}
              {isModerator ? (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => void run(onRole(person.user_id, "moderator", false))}
                >
                  Remove moderator
                </Button>
              ) : (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() => void run(onRole(person.user_id, "moderator", true))}
                >
                  Make moderator
                </Button>
              )}
            </div>
          </Card>
        );
      })}
    </div>
  );
};

export default PeopleTable;
