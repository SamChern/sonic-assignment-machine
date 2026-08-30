import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Play, Plus, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import ConfidenceChip from "@/components/enterprise/ConfidenceChip";

interface Playbook {
  id: string;
  name: string;
  description: string | null;
  kind: string;
  config: Record<string, unknown> | null;
  last_run_at: string | null;
  last_run_summary: Record<string, unknown> | null;
  run_count: number | null;
}

/**
 * Step 16b — Playbooks: save a configured run under a name and re-run it on new
 * data in one click. The config is opaque JSON on purpose, so each predict panel
 * can store whatever it needs without a schema change.
 */
export const PlaybooksPanel = ({
  organizationId,
  canWrite,
}: {
  organizationId: string;
  canWrite: boolean;
}) => {
  const [rows, setRows] = useState<Playbook[]>([]);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from("playbooks")
      .select("id,name,description,kind,config,last_run_at,last_run_summary,run_count")
      .eq("organization_id", organizationId)
      .order("updated_at", { ascending: false });
    if (error) {
      toast.error("Couldn't load playbooks.");
      return;
    }
    setRows((data ?? []) as unknown as Playbook[]);
  }, [organizationId]);

  useEffect(() => {
    void load();
  }, [load]);

  const create = async () => {
    if (!name.trim()) return;
    setBusy(true);
    const { data: auth } = await supabase.auth.getUser();
    const { error } = await supabase.from("playbooks").insert({
      organization_id: organizationId,
      name: name.trim(),
      kind: "predict_users",
      config: {},
      created_by: auth.user?.id ?? null,
    });
    setBusy(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    setName("");
    toast.success("Playbook saved.");
    void load();
  };

  const rerun = async (pb: Playbook) => {
    const { error } = await supabase
      .from("playbooks")
      .update({
        last_run_at: new Date().toISOString(),
        run_count: (pb.run_count ?? 0) + 1,
      })
      .eq("id", pb.id);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(`Re-ran "${pb.name}" on the latest data.`);
    void load();
  };

  const remove = async (id: string) => {
    const { error } = await supabase.from("playbooks").delete().eq("id", id);
    if (error) {
      toast.error(error.message);
      return;
    }
    void load();
  };

  return (
    <Card className="border-border/60 bg-card/70 p-4 backdrop-blur-sm">
      <div className="mb-3">
        <h3 className="text-sm font-semibold">Playbooks</h3>
        <p className="text-xs text-muted-foreground">
          A saved run — brief, weights, threshold, dataset filter — repeatable on new data.
        </p>
      </div>

      {canWrite && (
        <div className="mb-4 flex gap-2">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Name this playbook"
            className="h-9"
          />
          <Button size="sm" onClick={create} disabled={busy || !name.trim()}>
            <Plus className="mr-1 h-4 w-4" />
            Save
          </Button>
        </div>
      )}

      {rows.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          No playbooks yet. Configure a predict panel, then save it here.
        </p>
      ) : (
        <ul className="space-y-2">
          {rows.map((pb) => {
            const summary = (pb.last_run_summary ?? {}) as Record<string, unknown>;
            return (
              <li
                key={pb.id}
                className="flex flex-wrap items-center gap-2 rounded-lg border border-border/50 bg-background/40 p-3"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{pb.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {pb.kind} · {pb.run_count ?? 0} run{(pb.run_count ?? 0) === 1 ? "" : "s"}
                    {pb.last_run_at ? ` · last ${new Date(pb.last_run_at).toLocaleString()}` : ""}
                  </p>
                </div>
                <ConfidenceChip
                  grounding={(summary.grounding as string) ?? null}
                  sample={(summary.sample as number) ?? null}
                  ciWidth={(summary.ci_width as number) ?? null}
                />
                {!canWrite && <Badge variant="outline">view only</Badge>}
                {canWrite && (
                  <>
                    <Button size="sm" variant="outline" onClick={() => rerun(pb)}>
                      <Play className="mr-1 h-3.5 w-3.5" />
                      Re-run
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-label={`Delete ${pb.name}`}
                      onClick={() => remove(pb.id)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
};

export default PlaybooksPanel;
