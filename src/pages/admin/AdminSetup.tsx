import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
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
import { toast } from "sonner";
import {
  ArrowLeft,
  Building2,
  Check,
  Loader2,
  Mail,
  RefreshCw,
  Trash2,
  UserCheck,
} from "lucide-react";

interface Org {
  id: string;
  name: string;
  slug: string;
  plan: string;
  created_at: string;
}

interface Member {
  user_id: string;
  role: string;
  email: string | null;
  invited_at: string | null;
  confirmed_at: string | null;
  last_sign_in_at: string | null;
  signed_in: boolean;
}

const ROLES = ["owner", "analyst", "viewer"] as const;

const STEPS = [
  { n: 1, label: "Create the organization" },
  { n: 2, label: "Invite the team" },
  { n: 3, label: "Confirm they can sign in" },
];

/**
 * Team setup wizard: create an enterprise organization, invite teammates with
 * an org role, then confirm each invited account has signed in for real.
 */
export default function AdminSetup() {
  const { user, isAdmin, loading: authLoading } = useAuth();
  const navigate = useNavigate();

  const [orgs, setOrgs] = useState<Org[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [org, setOrg] = useState<Org | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<string>("analyst");
  const [busy, setBusy] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!authLoading && (!user || !isAdmin)) navigate("/");
  }, [authLoading, user, isAdmin, navigate]);

  const call = useCallback(async (body: Record<string, unknown>) => {
    const { data, error } = await supabase.functions.invoke("admin-org-setup", { body });
    if (error) throw error;
    const res = data as { success?: boolean; error?: string };
    if (res?.success === false) throw new Error(res.error ?? "setup call failed");
    return data as Record<string, unknown>;
  }, []);

  const loadOrgs = useCallback(async () => {
    setLoading(true);
    try {
      const res = (await call({ action: "orgs" })) as {
        orgs?: Org[];
        member_counts?: Record<string, number>;
      };
      setOrgs(res.orgs ?? []);
      setCounts(res.member_counts ?? {});
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [call]);

  useEffect(() => {
    if (!isAdmin) return;
    void loadOrgs();
  }, [isAdmin, loadOrgs]);

  const selectOrg = async (next: Org) => {
    setOrg(next);
    setBusy("members");
    try {
      const res = (await call({ action: "members", organization_id: next.id })) as {
        members?: Member[];
      };
      setMembers(res.members ?? []);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const createOrg = async () => {
    if (!name.trim()) return;
    setBusy("create");
    try {
      const res = (await call({
        action: "create_org",
        name: name.trim(),
        slug: slug.trim() || undefined,
      })) as { org?: Org; members?: Member[] };
      if (res.org) {
        setOrg(res.org);
        setMembers(res.members ?? []);
        setOrgs((prev) => [res.org as Org, ...prev]);
        setName("");
        setSlug("");
        toast.success(`${res.org.name} created — you are its owner`);
      }
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const invite = async () => {
    if (!org || !email.trim()) return;
    setBusy("invite");
    try {
      const res = (await call({
        action: "invite",
        organization_id: org.id,
        email: email.trim(),
        role,
        redirect_to: `${window.location.origin}/workspace`,
      })) as { invited?: boolean; members?: Member[] };
      setMembers(res.members ?? []);
      toast.success(
        res.invited
          ? `Invite emailed to ${email.trim()} as ${role}`
          : `${email.trim()} already had an account — added as ${role}`,
      );
      setEmail("");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const changeRole = async (member: Member, next: string) => {
    if (!org) return;
    setBusy(member.user_id);
    try {
      const res = (await call({
        action: "set_role",
        organization_id: org.id,
        user_id: member.user_id,
        role: next,
      })) as { members?: Member[] };
      setMembers(res.members ?? []);
      toast.success(`${member.email ?? "Member"} is now ${next}`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const removeMember = async (member: Member) => {
    if (!org) return;
    setBusy(member.user_id);
    try {
      const res = (await call({
        action: "remove_member",
        organization_id: org.id,
        user_id: member.user_id,
      })) as { members?: Member[] };
      setMembers(res.members ?? []);
      toast.success("Member removed");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const refreshMembers = () => org && void selectOrg(org);
  const signedIn = members.filter((m) => m.signed_in).length;
  const step = !org ? 1 : members.length <= 1 ? 2 : 3;

  if (authLoading || !isAdmin) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-4xl space-y-4 px-4 py-6">
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="ghost" className="h-8" onClick={() => navigate("/admin")}>
            <ArrowLeft className="mr-1 h-4 w-4" /> Admin
          </Button>
          <Building2 className="h-5 w-5 text-primary" />
          <h1 className="text-lg font-semibold">Team setup</h1>
        </div>

        <div className="flex flex-wrap gap-2">
          {STEPS.map((s) => (
            <Badge
              key={s.n}
              variant={step >= s.n ? "secondary" : "outline"}
              className="text-[10px]"
            >
              {step > s.n ? <Check className="mr-1 h-3 w-3" /> : null}
              {s.n}. {s.label}
            </Badge>
          ))}
        </div>

        <Card className="space-y-3 border-primary/20 bg-card/70 p-4 backdrop-blur">
          <h2 className="text-sm font-semibold">1 · Organization</h2>
          <div className="flex flex-wrap gap-2">
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Organization name"
              className="h-9 flex-1 min-w-[180px] text-xs"
            />
            <Input
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              placeholder="slug (optional)"
              className="h-9 w-40 text-xs"
            />
            <Button
              size="sm"
              className="h-9 text-[11px]"
              disabled={busy === "create" || !name.trim()}
              onClick={createOrg}
            >
              {busy === "create" ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : null}
              Create
            </Button>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[11px] text-muted-foreground">or pick an existing one:</span>
            <Button size="sm" variant="ghost" className="h-7" onClick={() => void loadOrgs()}>
              {loading ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <RefreshCw className="h-3 w-3" />
              )}
            </Button>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {orgs.map((o) => (
              <Button
                key={o.id}
                size="sm"
                variant={org?.id === o.id ? "secondary" : "outline"}
                className="h-7 text-[11px]"
                onClick={() => void selectOrg(o)}
              >
                {o.name}
                <span className="ml-1 text-muted-foreground">{counts[o.id] ?? 0}</span>
              </Button>
            ))}
            {!loading && !orgs.length && (
              <p className="text-[11px] text-muted-foreground">No organizations yet.</p>
            )}
          </div>
        </Card>

        <Card className="space-y-3 border-primary/20 bg-card/70 p-4 backdrop-blur">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-sm font-semibold">2 · Invite the team</h2>
            {org && (
              <Badge variant="outline" className="text-[10px]">{org.name}</Badge>
            )}
          </div>
          {!org ? (
            <p className="text-[11px] text-muted-foreground">
              Create or select an organization first.
            </p>
          ) : (
            <div className="flex flex-wrap gap-2">
              <Input
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="teammate@company.com"
                className="h-9 flex-1 min-w-[200px] text-xs"
              />
              <Select value={role} onValueChange={setRole}>
                <SelectTrigger className="h-9 w-32 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ROLES.map((r) => (
                    <SelectItem key={r} value={r} className="text-xs">
                      {r}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                size="sm"
                className="h-9 text-[11px]"
                disabled={busy === "invite" || !email.trim()}
                onClick={invite}
              >
                {busy === "invite" ? (
                  <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                ) : (
                  <Mail className="mr-1 h-3 w-3" />
                )}
                Send invite
              </Button>
            </div>
          )}
        </Card>

        <Card className="space-y-3 border-primary/20 bg-card/70 p-4 backdrop-blur">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-sm font-semibold">3 · Sign-in confirmation</h2>
            {org && (
              <Badge variant="outline" className="text-[10px]">
                {signedIn}/{members.length} signed in
              </Badge>
            )}
            <Button
              size="sm"
              variant="ghost"
              className="ml-auto h-7 text-[11px]"
              disabled={!org || busy === "members"}
              onClick={refreshMembers}
            >
              {busy === "members" ? (
                <Loader2 className="mr-1 h-3 w-3 animate-spin" />
              ) : (
                <RefreshCw className="mr-1 h-3 w-3" />
              )}
              Check
            </Button>
          </div>
          <div className="divide-y divide-border/50 rounded-lg border border-border/60">
            {members.map((m) => (
              <div key={m.user_id} className="flex flex-wrap items-center gap-2 px-3 py-2">
                <span className="text-xs">{m.email ?? m.user_id.slice(0, 8)}</span>
                <Badge
                  variant={m.signed_in ? "secondary" : "outline"}
                  className="gap-1 px-1 py-0 text-[9px]"
                >
                  {m.signed_in ? <UserCheck className="h-3 w-3" /> : null}
                  {m.signed_in
                    ? `signed in ${new Date(m.last_sign_in_at as string).toLocaleDateString()}`
                    : m.confirmed_at
                    ? "confirmed, not signed in"
                    : "invite pending"}
                </Badge>
                <Select
                  value={m.role}
                  onValueChange={(next) => void changeRole(m, next)}
                >
                  <SelectTrigger className="ml-auto h-7 w-28 text-[11px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ROLES.map((r) => (
                      <SelectItem key={r} value={r} className="text-xs">
                        {r}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 px-1.5"
                  disabled={busy === m.user_id}
                  onClick={() => void removeMember(m)}
                >
                  <Trash2 className="h-3 w-3" />
                </Button>
              </div>
            ))}
            {org && !members.length && (
              <p className="px-3 py-3 text-[11px] text-muted-foreground">
                No members yet — send an invite above.
              </p>
            )}
            {!org && (
              <p className="px-3 py-3 text-[11px] text-muted-foreground">
                Select an organization to see its members.
              </p>
            )}
          </div>
          {org && signedIn > 1 && (
            <p className="text-[11px] text-primary">
              A team account has signed in — the workspace at /workspace is live for them.
            </p>
          )}
        </Card>
      </div>
    </div>
  );
}
