import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "@/hooks/use-toast";
import { Link2, Loader2, RefreshCw, ShieldCheck, Trash2 } from "lucide-react";
import ConfirmAction from "@/components/ConfirmAction";
import { friendlyError } from "@/lib/friendlyError";

interface GrantedActivation {
  id: string;
  activation_id: string;
  label: string | null;
  notes: string | null;
  last_synced_at: string | null;
  available_profiles?: number;
}

interface Props {
  organizationId: string;
  canWrite: boolean;
  onSynced?: () => void;
}

const IntuiziSyncPanel = ({ organizationId, canWrite, onSynced }: Props) => {
  const { isAdmin } = useAuth();
  const [rows, setRows] = useState<GrantedActivation[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);

  const [newActivation, setNewActivation] = useState("");
  const [newLabel, setNewLabel] = useState("");
  const [granting, setGranting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase.functions.invoke("workspace-intuizi-sync", {
      body: { organization_id: organizationId, action: "list" },
    });
    setLoading(false);
    if (error || !data?.success) {
      toast({
        title: "Could not load granted activations",
        description: error?.message ?? data?.error ?? "Unknown error",
        variant: "destructive",
      });
      return;
    }
    setRows(data.activations ?? []);
    setSelected([]);
  }, [organizationId]);

  useEffect(() => {
    void load();
  }, [load]);

  const toggle = (activationId: string) =>
    setSelected((prev) =>
      prev.includes(activationId)
        ? prev.filter((a) => a !== activationId)
        : [...prev, activationId],
    );

  const sync = useCallback(async () => {
    if (!selected.length) return;
    setSyncing(true);
    const { data, error } = await supabase.functions.invoke("workspace-intuizi-sync", {
      body: { organization_id: organizationId, action: "sync", activation_ids: selected },
    });
    setSyncing(false);
    if (error || !data?.success) {
      toast({
        title: "Sync failed",
        description: error?.message ?? data?.error ?? "Unknown error",
        variant: "destructive",
      });
      return;
    }
    const results = (data.results ?? []) as { rows_synced: number }[];
    const total = results.reduce((n, r) => n + (r.rows_synced ?? 0), 0);
    toast({
      title: "Synced with Intuizi",
      description: `${total} profile(s) pulled into ${results.length} dataset(s).`,
    });
    onSynced?.();
    void load();
  }, [selected, organizationId, onSynced, load]);

  const grant = useCallback(async () => {
    const activationId = newActivation.trim().replace(/^#/, "");
    if (!activationId) return;
    setGranting(true);
    const { error } = await supabase.from("org_intuizi_activations").insert({
      organization_id: organizationId,
      activation_id: activationId,
      label: newLabel.trim() || null,
    });
    setGranting(false);
    if (error) {
      toast({ title: "Could not grant access", description: friendlyError(error.message), variant: "destructive" });
      return;
    }
    setNewActivation("");
    setNewLabel("");
    void load();
  }, [newActivation, newLabel, organizationId, load]);

  const revoke = useCallback(async (id: string) => {
    const { error } = await supabase.from("org_intuizi_activations").delete().eq("id", id);
    if (error) {
      toast({ title: "Could not revoke", description: friendlyError(error.message), variant: "destructive" });
      return;
    }
    void load();
  }, [load]);

  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Link2 className="h-4 w-4 text-primary" />
        <h2 className="text-sm font-semibold">Sync with Intuizi</h2>
        <Badge variant="outline" className="text-[11px]">Granted activations only</Badge>
        <Button variant="ghost" size="sm" className="ml-auto" onClick={() => void load()}>
          <RefreshCw className="mr-1 h-4 w-4" />
          Refresh
        </Button>
      </div>

      <p className="mt-2 text-xs text-muted-foreground">
        Pull the semantic profiles for the specific Intuizi activations your workspace has been
        granted. Each activation lands as its own dataset — re-syncing refreshes it in place.
      </p>

      <div className="mt-3 space-y-2">
        {loading && (
          <p className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading granted activations…
          </p>
        )}
        {!loading && !rows.length && (
          <p className="rounded-lg border border-border/60 bg-muted/20 p-3 text-xs text-muted-foreground">
            No Intuizi activations are granted to this workspace yet. Ask your SonicSIM
            administrator to grant the activations you licensed.
          </p>
        )}
        {rows.map((r) => (
          <label
            key={r.id}
            className="flex flex-wrap items-center gap-2 rounded-lg border border-border/60 bg-muted/20 p-3 text-xs"
          >
            <Checkbox
              checked={selected.includes(r.activation_id)}
              onCheckedChange={() => toggle(r.activation_id)}
              disabled={!canWrite}
            />
            <span className="font-medium">
              {r.label?.trim() || `Activation ${r.activation_id}`}
            </span>
            <Badge variant="secondary" className="text-[10px]">#{r.activation_id}</Badge>
            <span className="text-muted-foreground">
              {r.available_profiles ?? 0} profile(s) available
            </span>
            <span className="text-muted-foreground">
              {r.last_synced_at
                ? `last synced ${new Date(r.last_synced_at).toLocaleString()}`
                : "never synced"}
            </span>
            {isAdmin && (
              <ConfirmAction
                title={`Revoke ${r.label?.trim() || `Activation ${r.activation_id}`}?`}
                description="This workspace will lose access to that activation's profiles until it is granted again. Data already synced stays."
                confirmLabel="Revoke access"
                onConfirm={() => revoke(r.id)}
                trigger={
                  <Button
                    variant="ghost"
                    size="sm"
                    className="ml-auto text-destructive"
                    aria-label={`Revoke access to activation ${r.activation_id}`}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                }
              />
            )}
          </label>
        ))}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={sync} disabled={!canWrite || syncing || !selected.length}>
          {syncing ? (
            <Loader2 className="mr-1 h-4 w-4 animate-spin" />
          ) : (
            <Link2 className="mr-1 h-4 w-4" />
          )}
          Sync {selected.length ? `${selected.length} activation(s)` : "with Intuizi"}
        </Button>
        {!canWrite && (
          <span className="text-[11px] text-muted-foreground">Your role is view-only.</span>
        )}
      </div>

      {isAdmin && (
        <div className="mt-4 rounded-lg border border-primary/30 bg-primary/5 p-3">
          <p className="flex items-center gap-2 text-xs font-medium">
            <ShieldCheck className="h-3.5 w-3.5 text-primary" />
            Admin: grant an activation to this workspace
          </p>
          <div className="mt-2 grid gap-2 sm:grid-cols-[140px_1fr_auto]">
            <Input
              value={newActivation}
              onChange={(e) => setNewActivation(e.target.value)}
              placeholder="Activation ID"
              inputMode="numeric"
            />
            <Input
              value={newLabel}
              onChange={(e) => setNewLabel(e.target.value)}
              placeholder="Label (optional)"
            />
            <Button size="sm" onClick={grant} disabled={granting || !newActivation.trim()}>
              {granting && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
              Grant
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
};

export default IntuiziSyncPanel;
