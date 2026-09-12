import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, Mail, Users } from "lucide-react";

export interface OrgMember {
  user_id: string;
  role: string;
  email: string | null;
  signed_in: boolean;
}

const ROLES = ["owner", "analyst", "viewer"] as const;

/** Invite people into an enterprise account and change their role. */
export default function OrgPeopleCard({
  members,
  busy,
  onInvite,
  onSetRole,
}: {
  members: OrgMember[];
  busy: string | null;
  onInvite: (email: string, role: string) => void;
  onSetRole: (userId: string, role: string) => void;
}) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<string>("analyst");

  return (
    <Card className="p-4">
      <p className="flex items-center gap-2 text-sm font-semibold">
        <Users className="h-4 w-4 text-primary" />
        People
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="teammate@company.com"
          className="w-full sm:w-64"
          aria-label="Invite email"
        />
        <Select value={role} onValueChange={setRole}>
          <SelectTrigger className="w-full sm:w-[150px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {ROLES.map((r) => (
              <SelectItem key={r} value={r} className="capitalize">
                {r}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          onClick={() => {
            if (!email.trim()) return;
            onInvite(email.trim(), role);
            setEmail("");
          }}
          disabled={busy === "invite"}
        >
          {busy === "invite" ? (
            <Loader2 className="mr-1 h-4 w-4 animate-spin" />
          ) : (
            <Mail className="mr-1 h-4 w-4" />
          )}
          Invite
        </Button>
      </div>
      <ul className="mt-3 divide-y divide-border/60">
        {members.map((m) => (
          <li key={m.user_id} className="flex flex-wrap items-center gap-2 py-2">
            <span className="min-w-0 flex-1 truncate text-sm">{m.email ?? m.user_id}</span>
            <Badge variant={m.signed_in ? "secondary" : "outline"} className="text-[10px]">
              {m.signed_in ? "signed in" : "invited"}
            </Badge>
            <Select value={m.role} onValueChange={(r) => onSetRole(m.user_id, r)}>
              <SelectTrigger className="h-8 w-[130px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ROLES.map((r) => (
                  <SelectItem key={r} value={r} className="capitalize">
                    {r}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </li>
        ))}
        {!members.length && <li className="py-2 text-sm text-muted-foreground">No people yet.</li>}
      </ul>
    </Card>
  );
}
