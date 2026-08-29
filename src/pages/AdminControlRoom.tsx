import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import {
  ArrowLeft,
  History,
  Loader2,
  RefreshCw,
  RotateCcw,
  SlidersHorizontal,
} from "lucide-react";
import {
  useControlRegistry,
  type ControlKnob,
} from "@/hooks/useControlRegistry";
import { ResolverPanel } from "@/components/admin/ResolverPanel";

const CATEGORY_LABELS: Record<string, string> = {
  scoring: "Scoring core",
  ingest: "Ingest & queue",
  cohorts: "Cohorts",
  compliance: "Retention & compliance",
  scope: "The Scope",
  general: "General",
};

function formatValue(value: unknown) {
  if (typeof value === "string") return value === "" ? "(auto)" : value;
  return JSON.stringify(value);
}

export default function AdminControlRoom() {
  const { user, isAdmin, loading } = useAuth();
  const navigate = useNavigate();
  const { knobs, audit, loading: busy, error, reload, setValue, revert } =
    useControlRegistry();

  const [draft, setDraft] = useState<Record<string, unknown>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [openHistory, setOpenHistory] = useState<string | null>(null);

  useEffect(() => {
    if (!loading && (!user || !isAdmin)) navigate("/");
  }, [loading, user, isAdmin, navigate]);

  const grouped = useMemo(() => {
    const map = new Map<string, ControlKnob[]>();
    for (const k of knobs) {
      const list = map.get(k.category) ?? [];
      list.push(k);
      map.set(k.category, list);
    }
    return [...map.entries()];
  }, [knobs]);

  const current = (k: ControlKnob) =>
    Object.prototype.hasOwnProperty.call(draft, k.key) ? draft[k.key] : k.value;

  const dirty = (k: ControlKnob) =>
    Object.prototype.hasOwnProperty.call(draft, k.key) &&
    JSON.stringify(draft[k.key]) !== JSON.stringify(k.value);

  const commit = async (k: ControlKnob, value: unknown) => {
    setSaving(k.key);
    try {
      await setValue(k.key, value);
      setDraft(d => {
        const next = { ...d };
        delete next[k.key];
        return next;
      });
      toast.success(`${k.key} updated — live within 60s`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Update failed");
    } finally {
      setSaving(null);
    }
  };

  const doRevert = async (k: ControlKnob) => {
    setSaving(k.key);
    try {
      await revert(k.key);
      toast.success(`${k.key} reverted to its previous value`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Revert failed");
    } finally {
      setSaving(null);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <main className="mx-auto w-full max-w-5xl px-4 pb-24 pt-6 sm:px-6">
      <header className="mb-6 flex flex-wrap items-center gap-3">
        <Button variant="ghost" size="sm" onClick={() => navigate("/admin")}>
          <ArrowLeft className="mr-1 h-4 w-4" /> Admin
        </Button>
        <div className="min-w-0 flex-1">
          <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight sm:text-2xl">
            <SlidersHorizontal className="h-5 w-5 text-primary" />
            Control Room
          </h1>
          <p className="text-xs text-muted-foreground sm:text-sm">
            Every tunable of the semantic core, live within 60 seconds — no deploy. Each
            change is logged and reversible.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void reload()} disabled={busy}>
          {busy ? (
            <Loader2 className="mr-1 h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="mr-1 h-4 w-4" />
          )}
          Refresh
        </Button>
      </header>

      {error && (
        <Card className="mb-4 border-destructive/40 p-4 text-sm text-destructive">
          {error}
        </Card>
      )}

      <div className="mb-6">
        <ResolverPanel />
      </div>

      <div className="space-y-6">
        {grouped.map(([category, rows]) => (
          <Card key={category} className="border-border/60 bg-card/60 p-4 backdrop-blur">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              {CATEGORY_LABELS[category] ?? category}
            </h2>
            <div className="space-y-5">
              {rows.map(k => {
                const value = current(k);
                const history = audit.filter(a => a.key === k.key).slice(0, 6);
                return (
                  <div key={k.key} className="rounded-lg border border-border/50 p-3">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <code className="text-sm font-medium">{k.key}</code>
                          <Badge variant="secondary" className="text-[10px]">
                            {k.value_type}
                          </Badge>
                          {dirty(k) && (
                            <Badge className="text-[10px]">unsaved</Badge>
                          )}
                        </div>
                        {k.description && (
                          <p className="mt-1 text-xs text-muted-foreground">
                            {k.description}
                          </p>
                        )}
                      </div>
                      <div className="flex items-center gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          aria-label={`History for ${k.key}`}
                          onClick={() =>
                            setOpenHistory(openHistory === k.key ? null : k.key)
                          }
                        >
                          <History className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          aria-label={`Revert ${k.key}`}
                          disabled={saving === k.key || history.length === 0}
                          onClick={() => void doRevert(k)}
                        >
                          <RotateCcw className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>

                    <div className="mt-3 flex flex-wrap items-center gap-3">
                      {k.value_type === "number" && (
                        <>
                          <Slider
                            aria-label={k.key}
                            className="min-w-[180px] flex-1"
                            min={k.bounds?.min ?? 0}
                            max={k.bounds?.max ?? 100}
                            step={k.bounds?.step ?? 1}
                            value={[Number(value) || 0]}
                            onValueChange={v =>
                              setDraft(d => ({ ...d, [k.key]: v[0] }))
                            }
                          />
                          <span className="w-16 text-right font-mono text-sm">
                            {String(value)}
                          </span>
                        </>
                      )}

                      {k.value_type === "boolean" && (
                        <Switch
                          aria-label={k.key}
                          checked={Boolean(value)}
                          onCheckedChange={v => setDraft(d => ({ ...d, [k.key]: v }))}
                        />
                      )}

                      {(k.value_type === "json" || k.value_type === "enum") && (
                        <Input
                          aria-label={k.key}
                          className="max-w-sm font-mono text-xs"
                          value={typeof value === "string" ? value : JSON.stringify(value)}
                          onChange={e =>
                            setDraft(d => ({ ...d, [k.key]: e.target.value }))
                          }
                        />
                      )}

                      <Button
                        size="sm"
                        disabled={!dirty(k) || saving === k.key}
                        onClick={() => void commit(k, current(k))}
                      >
                        {saving === k.key ? (
                          <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                        ) : null}
                        Save
                      </Button>
                    </div>

                    {openHistory === k.key && (
                      <ul className="mt-3 space-y-1 border-t border-border/50 pt-2 text-xs text-muted-foreground">
                        {history.length === 0 && <li>No changes recorded yet.</li>}
                        {history.map(h => (
                          <li key={h.id} className="font-mono">
                            {new Date(h.changed_at).toLocaleString()} ·{" "}
                            {formatValue(h.old_value)} → {formatValue(h.new_value)}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                );
              })}
            </div>
          </Card>
        ))}
        {!busy && knobs.length === 0 && (
          <Card className="p-6 text-sm text-muted-foreground">
            No controls visible. Control Room access requires an admin role.
          </Card>
        )}
      </div>
    </main>
  );
}
