import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import {
  ArrowLeft,
  Building2,
  KeyRound,
  Loader2,
  Plus,
  RefreshCw,
  Save,
} from "lucide-react";
import CapabilitySwitches from "@/components/admin/enterprise/CapabilitySwitches";
import OrgPeopleCard from "@/components/admin/enterprise/OrgPeopleCard";
import {
  ALL_CAPABILITIES,
  toCapabilities,
  type Capabilities,
} from "@/lib/orgCapabilities";

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

interface Grant {
  id: string;
  activation_id: string;
  label: string | null;
  is_active: boolean;
  last_synced_at: string | null;
}

const ROLES = ["owner", "analyst", "viewer"] as const;

/**
 * Provision and permission enterprise accounts: create the account, invite its
 * owner, set what the account may reach, and share Intuizi data feeds with it.
 */
export default function AdminEnterpriseAccounts() {
  const [orgs, setOrgs] = useState<Org[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [grantCounts, setGrantCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  // New account form
  const [name, setName] = useState("");
  const [ownerEmail, setOwnerEmail] = useState("");
  const [newCaps, setNewCaps] = useState<Capabilities>({ ...ALL_CAPABILITIES });
  const [grantAll, setGrantAll] = useState(true);

  // Selected account
  const [org, setOrg] = useState<Org | null>(null);
  const [caps, setCaps] = useState<Capabilities>({ ...ALL_CAPABILITIES });
  const [notes, setNotes] = useState("");
  const [members, setMembers] = useState<Member[]>([]);
  const [grants, setGrants] = useState<Grant[]>([]);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<string>("analyst");
  const [feedIds, setFeedIds] = useState("");

  const call = useCallback(async (body: Record<string, unknown>) => {
    const { data, error } = await supabase.functions.invoke("admin-org-setup", { body });
    if (error) throw error;
    const res = data as { success?: boolean; error?: string };
    if (res?.success === false) throw new Error(res.error ?? "request failed");
    return data as Record<string, unknown>;
  }, []);

  const loadOrgs = useCallback(async () => {
    setLoading(true);
    try {
      const res = (await call({ action: "orgs" })) as {
        orgs?: Org[];
        member_counts?: Record<string, number>;
        grant_counts?: Record<string, number>;
      };
      setOrgs(res.orgs ?? []);
      setCounts(res.member_counts ?? {});
      setGrantCounts(res.grant_counts ?? {});
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [call]);

  useEffect(() => {
    void loadOrgs();
  }, [loadOrgs]);

  const openOrg = useCallback(
    async (next: Org) => {
      setOrg(next);
      setBusy("detail");
      try {
        const res = (await call({ action: "org_detail", organization_id: next.id })) as {
          capabilities?: Record<string, unknown>;
          members?: Member[];
          grants?: Grant[];
        };
        setCaps(toCapabilities(res.capabilities ?? null));
        setNotes(String((res.capabilities as { notes?: string } | null)?.notes ?? ""));
        setMembers(res.members ?? []);
        setGrants(res.grants ?? []);
      } catch (e) {
        toast.error((e as Error).message);
      } finally {
        setBusy(null);
      }
    },
    [call],
  );

  const provision = async () => {
    if (!name.trim() || !ownerEmail.trim()) {
      toast.error("Account name and owner email are both needed.");
      return;
    }
    setBusy("provision");
    try {
      const res = (await call({
        action: "provision_org",
        name: name.trim(),
        owner_email: ownerEmail.trim(),
        plan: "enterprise",
        capabilities: newCaps,
        redirect_to: `${window.location.origin}/workspace`,
      })) as { org?: Org; owner_invited?: boolean };
      const created = res.org;
      if (!created) throw new Error("no account returned");
      if (grantAll) {
        await call({
          action: "grant_activations",
          organization_id: created.id,
          all_current: true,
        });
      }
      toast.success(
        res.owner_invited
          ? `${created.name} created — invite sent to ${ownerEmail}.`
          : `${created.name} created and ${ownerEmail} added as owner.`,
      );
      setName("");
      setOwnerEmail("");
      await loadOrgs();
      await openOrg(created);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const saveCaps = async () => {
    if (!org) return;
    setBusy("caps");
    try {
      await call({
        action: "set_capabilities",
        organization_id: org.id,
        capabilities: caps,
        notes,
      });
      toast.success("Access saved.");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const grantFeeds = async (allCurrent: boolean) => {
    if (!org) return;
    setBusy("grants");
    try {
      const res = (await call({
        action: "grant_activations",
        organization_id: org.id,
        all_current: allCurrent,
        activation_ids: allCurrent
          ? []
          : feedIds
              .split(/[\s,]+/)
              .map((s) => s.trim())
              .filter(Boolean),
      })) as { grants?: Grant[]; granted?: number };
      setGrants(res.grants ?? []);
      setFeedIds("");
      toast.success(`Shared ${res.granted ?? 0} data feed(s).`);
      await loadOrgs();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const invite = async (email: string, role: string) => {
    if (!org || !email) return;
    setBusy("invite");
    try {
      const res = (await call({
        action: "invite",
        organization_id: org.id,
        email,
        role,
        redirect_to: `${window.location.origin}/workspace`,
      })) as { members?: Member[] };
      setMembers(res.members ?? members);
      toast.success(`Invited ${email} as ${role}.`);
      await loadOrgs();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const setRole = async (userId: string, role: string) => {
    if (!org) return;
    setBusy(userId);
    try {
      const res = (await call({
        action: "set_role",
        organization_id: org.id,
        user_id: userId,
        role,
      })) as { members?: Member[] };
      setMembers(res.members ?? members);
      toast.success(`Role set to ${role}.`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const CapSwitches = CapabilitySwitches;

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-4 py-6 pb-mobile-nav">
      <div className="flex flex-wrap items-center gap-2">
        <Button asChild variant="ghost" size="sm">
          <Link to="/admin">
            <ArrowLeft className="mr-1 h-4 w-4" />
            Admin
          </Link>
        </Button>
        <h1 className="text-xl font-semibold">Enterprise accounts</h1>
        <Button
          variant="outline"
          size="sm"
          className="ml-auto"
          onClick={() => void loadOrgs()}
          disabled={loading}
        >
          {loading ? (
            <Loader2 className="mr-1 h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="mr-1 h-4 w-4" />
          )}
          Refresh
        </Button>
      </div>

      <Card className="p-4">
        <p className="flex items-center gap-2 text-sm font-semibold">
          <Plus className="h-4 w-4 text-primary" />
          Create an account
        </p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div>
            <Label htmlFor="org-name">Account name</Label>
            <Input
              id="org-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Rubinstein Law"
            />
          </div>
          <div>
            <Label htmlFor="owner-email">Owner email</Label>
            <Input
              id="owner-email"
              type="email"
              value={ownerEmail}
              onChange={(e) => setOwnerEmail(e.target.value)}
              placeholder="name@company.com"
            />
          </div>
        </div>
        <div className="mt-3">
          <CapSwitches value={newCaps} onChange={setNewCaps} />
        </div>
        <label className="mt-3 flex items-center justify-between gap-3 rounded-lg border border-border/60 bg-muted/20 p-3">
          <span className="text-sm">Share every data feed we already work with</span>
          <Switch checked={grantAll} onCheckedChange={setGrantAll} aria-label="Share all feeds" />
        </label>
        <Button className="mt-3" onClick={() => void provision()} disabled={busy === "provision"}>
          {busy === "provision" ? (
            <Loader2 className="mr-1 h-4 w-4 animate-spin" />
          ) : (
            <Building2 className="mr-1 h-4 w-4" />
          )}
          Create and invite owner
        </Button>
      </Card>

      <Card className="p-4">
        <p className="text-sm font-semibold">Accounts</p>
        {loading ? (
          <p className="mt-2 text-sm text-muted-foreground">Loading…</p>
        ) : (
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {orgs.map((o) => (
              <button
                key={o.id}
                onClick={() => void openOrg(o)}
                className={`rounded-lg border p-3 text-left transition-smooth hover:shadow-elegant ${
                  org?.id === o.id ? "border-primary bg-primary/5" : "border-border/60 bg-muted/20"
                }`}
              >
                <span className="flex items-center gap-2">
                  <span className="truncate text-sm font-medium">{o.name}</span>
                  <Badge variant="outline" className="text-[10px] capitalize">
                    {o.plan}
                  </Badge>
                </span>
                <span className="mt-1 block text-xs text-muted-foreground">
                  {counts[o.id] ?? 0} people · {grantCounts[o.id] ?? 0} data feeds
                </span>
              </button>
            ))}
            {!orgs.length && (
              <p className="text-sm text-muted-foreground">No accounts yet.</p>
            )}
          </div>
        )}
      </Card>

      {org && (
        <>
          <Card className="p-4">
            <p className="flex items-center gap-2 text-sm font-semibold">
              <KeyRound className="h-4 w-4 text-primary" />
              What {org.name} can reach
            </p>
            <div className="mt-3">
              <CapSwitches value={caps} onChange={setCaps} />
            </div>
            <div className="mt-3">
              <Label htmlFor="org-notes">Internal notes</Label>
              <Textarea
                id="org-notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
                placeholder="Why this account has this access"
              />
            </div>
            <Button className="mt-3" onClick={() => void saveCaps()} disabled={busy === "caps"}>
              {busy === "caps" ? (
                <Loader2 className="mr-1 h-4 w-4 animate-spin" />
              ) : (
                <Save className="mr-1 h-4 w-4" />
              )}
              Save access
            </Button>
          </Card>

          <Card className="p-4">
            <p className="text-sm font-semibold">Data feeds shared with {org.name}</p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {grants.length ? (
                grants.map((g) => (
                  <Badge key={g.id} variant="secondary" className="text-[10px]">
                    #{g.activation_id}
                    {g.is_active ? "" : " (paused)"}
                  </Badge>
                ))
              ) : (
                <span className="text-xs text-muted-foreground">None yet.</span>
              )}
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <Input
                value={feedIds}
                onChange={(e) => setFeedIds(e.target.value)}
                placeholder="5581, 5628"
                className="w-full sm:w-56"
                aria-label="Feed ids to share"
              />
              <Button
                variant="outline"
                onClick={() => void grantFeeds(false)}
                disabled={busy === "grants" || !feedIds.trim()}
              >
                Share these
              </Button>
              <Button
                variant="outline"
                onClick={() => void grantFeeds(true)}
                disabled={busy === "grants"}
              >
                Share all current feeds
              </Button>
            </div>
          </Card>

          <OrgPeopleCard
            members={members}
            busy={busy}
            onInvite={(email, role) => void invite(email, role)}
            onSetRole={(userId, role) => void setRole(userId, role)}
          />
        </>
      )}
    </div>
  );
}
