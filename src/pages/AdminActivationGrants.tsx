import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { ArrowLeft, KeyRound, Loader2, RefreshCw, ShieldCheck, Trash2 } from "lucide-react";

interface Org {
  id: string;
  name: string;
  slug: string;
}

interface Grant {
  id: string;
  organization_id: string;
  activation_id: string;
  label: string | null;
  notes: string | null;
  is_active: boolean;
  last_synced_at: string | null;
  created_at: string;
}

export default function AdminActivationGrants() {
  const { user, isAdmin, loading } = useAuth();
  const navigate = useNavigate();

  const [orgs, setOrgs] = useState<Org[]>([]);
  const [grants, setGrants] = useState<Grant[]>([]);
  const [busy, setBusy] = useState(false);
  const [orgFilter, setOrgFilter] = useState<string>("all");

  const [orgId, setOrgId] = useState<string>("");
  const [activationId, setActivationId] = useState("");
  const [label, setLabel] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!loading && (!user || !isAdmin)) navigate("/");
  }, [loading, user, isAdmin, navigate]);

  const load = useCallback(async () => {
    setBusy(true);
    const [orgRes, grantRes] = await Promise.all([
      supabase.from("organizations").select("id,name,slug").order("name"),
      supabase
        .from("org_intuizi_activations")
        .select("id,organization_id,activation_id,label,notes,is_active,last_synced_at,created_at")
        .order("created_at", { ascending: false }),
    ]);
    setBusy(false);
    if (orgRes.error) toast.error(`Could not load organizations: ${orgRes.error.message}`);
    else setOrgs(orgRes.data ?? []);
    if (grantRes.error) toast.error(`Could not load grants: ${grantRes.error.message}`);
    else setGrants(grantRes.data ?? []);
  }, []);

  useEffect(() => {
    if (isAdmin) void load();
  }, [isAdmin, load]);

  const orgName = useMemo(() => {
    const map = new Map(orgs.map((o) => [o.id, o.name]));
    return (id: string) => map.get(id) ?? id.slice(0, 8);
  }, [orgs]);

  const visible = useMemo(
    () => (orgFilter === "all" ? grants : grants.filter((g) => g.organization_id === orgFilter)),
    [grants, orgFilter],
  );

  const addGrant = useCallback(async () => {
    const act = activationId.trim().replace(/^#/, "");
    if (!orgId || !act) {
      toast.error("Pick an organization and enter an activation ID");
      return;
    }
    setSaving(true);
    const { error } = await supabase.from("org_intuizi_activations").insert({
      organization_id: orgId,
      activation_id: act,
      label: label.trim() || null,
      notes: notes.trim() || null,
      granted_by: user?.id ?? null,
    });
    setSaving(false);
    if (error) {
      toast.error(
        error.code === "23505" || /duplicate/i.test(error.message)
          ? "That activation is already granted to this organization"
          : error.message,
      );
      return;
    }
    setActivationId("");
    setLabel("");
    setNotes("");
    toast.success(`Activation ${act} granted`);
    void load();
  }, [orgId, activationId, label, notes, user, load]);

  const toggleActive = useCallback(async (g: Grant) => {
    const { error } = await supabase
      .from("org_intuizi_activations")
      .update({ is_active: !g.is_active })
      .eq("id", g.id);
    if (error) {
      toast.error(error.message);
      return;
    }
    setGrants((prev) =>
      prev.map((x) => (x.id === g.id ? { ...x, is_active: !g.is_active } : x)),
    );
  }, []);

  const saveLabel = useCallback(async (g: Grant, next: string) => {
    const value = next.trim() || null;
    if (value === (g.label ?? null)) return;
    const { error } = await supabase
      .from("org_intuizi_activations")
      .update({ label: value })
      .eq("id", g.id);
    if (error) {
      toast.error(error.message);
      return;
    }
    setGrants((prev) => prev.map((x) => (x.id === g.id ? { ...x, label: value } : x)));
  }, []);

  const revoke = useCallback(async (g: Grant) => {
    const { error } = await supabase.from("org_intuizi_activations").delete().eq("id", g.id);
    if (error) {
      toast.error(error.message);
      return;
    }
    setGrants((prev) => prev.filter((x) => x.id !== g.id));
    toast.success(`Activation ${g.activation_id} revoked`);
  }, []);

  if (loading || !isAdmin) return null;

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border/60 bg-card/70 backdrop-blur-sm">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-2 px-3 py-4 sm:px-4">
          <Button variant="ghost" size="sm" onClick={() => navigate("/admin")}>
            <ArrowLeft className="mr-1 h-4 w-4" />
            Admin
          </Button>
          <h1 className="flex items-center gap-2 text-sm font-semibold sm:text-base">
            <KeyRound className="h-4 w-4 text-primary" />
            Intuizi activation access
          </h1>
          <Button variant="outline" size="sm" className="ml-auto" onClick={() => void load()}>
            {busy ? (
              <Loader2 className="mr-1 h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="mr-1 h-4 w-4" />
            )}
            Refresh
          </Button>
        </div>
      </header>

      <main className="mx-auto max-w-5xl space-y-4 px-3 py-5 pb-mobile-nav sm:px-4">
        <Card className="p-4">
          <p className="flex items-center gap-2 text-sm font-semibold">
            <ShieldCheck className="h-4 w-4 text-primary" />
            Grant an activation to an organization
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Enterprise workspaces can only sync the activations listed here — never the full
            Intuizi inventory.
          </p>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            <Select value={orgId} onValueChange={setOrgId}>
              <SelectTrigger>
                <SelectValue placeholder="Organization" />
              </SelectTrigger>
              <SelectContent>
                {orgs.map((o) => (
                  <SelectItem key={o.id} value={o.id}>
                    {o.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input
              value={activationId}
              onChange={(e) => setActivationId(e.target.value)}
              placeholder="Activation ID (e.g. 5580)"
              inputMode="numeric"
            />
            <Input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Dataset label (optional)"
            />
            <Input
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Notes (optional)"
            />
          </div>
          <Button size="sm" className="mt-3" onClick={addGrant} disabled={saving}>
            {saving && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
            Grant access
          </Button>
        </Card>

        <Card className="p-4">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-sm font-semibold">Current grants</h2>
            <Badge variant="outline" className="text-[11px]">{visible.length}</Badge>
            <div className="ml-auto w-full sm:w-56">
              <Select value={orgFilter} onValueChange={setOrgFilter}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All organizations</SelectItem>
                  {orgs.map((o) => (
                    <SelectItem key={o.id} value={o.id}>
                      {o.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="mt-3 space-y-2">
            {!visible.length && (
              <p className="rounded-lg border border-border/60 bg-muted/20 p-3 text-xs text-muted-foreground">
                No activation grants yet.
              </p>
            )}
            {visible.map((g) => (
              <div
                key={g.id}
                className="flex flex-wrap items-center gap-2 rounded-lg border border-border/60 bg-muted/20 p-3 text-xs"
              >
                <Badge variant="secondary" className="text-[10px]">#{g.activation_id}</Badge>
                <span className="font-medium">{orgName(g.organization_id)}</span>
                <Input
                  defaultValue={g.label ?? ""}
                  placeholder="Label"
                  className="h-8 w-full max-w-[220px] text-xs"
                  onBlur={(e) => void saveLabel(g, e.target.value)}
                />
                <span className="text-muted-foreground">
                  {g.last_synced_at
                    ? `last synced ${new Date(g.last_synced_at).toLocaleString()}`
                    : "never synced"}
                </span>
                <label className="ml-auto flex items-center gap-2">
                  <Switch checked={g.is_active} onCheckedChange={() => void toggleActive(g)} />
                  <span className="text-[11px] text-muted-foreground">
                    {g.is_active ? "Active" : "Paused"}
                  </span>
                </label>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-destructive"
                  onClick={() => void revoke(g)}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            ))}
          </div>
        </Card>
      </main>
    </div>
  );
}
