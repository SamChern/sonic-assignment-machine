import { useCallback, useEffect, useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  Users,
  RefreshCw,
  Upload,
  ShieldCheck,
  AlertTriangle,
  FileArchive,
  Loader2,
  Clock,
} from "lucide-react";

const MIN_MEMBERS = 1000;

interface ServerCohort {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  narrative: string | null;
  member_count: number;
  export_eligible: boolean;
  updated_at: string | null;
}

interface CohortExport {
  id: string;
  cohort_slug: string;
  object_key: string;
  dt: string;
  row_count: number | null;
  bytes: number | null;
  status: string;
  error: string | null;
  created_at: string;
}

function bytesLabel(n: number | null) {
  if (!n) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function ServerCohortPanel() {
  const [cohorts, setCohorts] = useState<ServerCohort[]>([]);
  const [exports, setExports] = useState<CohortExport[]>([]);
  const [loading, setLoading] = useState(true);
  const [building, setBuilding] = useState(false);
  const [exporting, setExporting] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const [cohortRes, exportRes] = await Promise.all([
      supabase
        .from("sonic_cohorts")
        .select("id, slug, name, description, narrative, member_count, export_eligible, updated_at")
        .order("member_count", { ascending: false }),
      supabase
        .from("sonic_cohort_exports")
        .select("id, cohort_slug, object_key, dt, row_count, bytes, status, error, created_at")
        .order("created_at", { ascending: false })
        .limit(60),
    ]);
    if (cohortRes.error) toast.error(`Could not load cohorts: ${cohortRes.error.message}`);
    setCohorts((cohortRes.data ?? []) as ServerCohort[]);
    setExports((exportRes.data ?? []) as CohortExport[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Newest succeeded export per cohort slug — drives the "Last activation" line.
  const lastActivation = useMemo(() => {
    const map = new Map<string, CohortExport>();
    for (const x of exports) {
      if (x.status !== "succeeded") continue;
      if (!map.has(x.cohort_slug)) map.set(x.cohort_slug, x);
    }
    return map;
  }, [exports]);

  const totalMembers = useMemo(
    () => cohorts.reduce((sum, c) => sum + (c.member_count ?? 0), 0),
    [cohorts],
  );

  const rebuild = async () => {
    setBuilding(true);
    try {
      const { data, error } = await supabase.functions.invoke("cohort-builder", {
        body: { source: "admin-ui" },
      });
      if (error) throw error;
      const res = data as { success?: boolean; error?: string; skipped?: string; k?: number };
      if (res?.skipped) toast.info(`Cohort build skipped — ${res.skipped}`);
      else if (res?.success) toast.success(`Rebuilt ${res.k ?? 0} sonic cohorts`);
      else toast.error(res?.error ?? "Cohort build failed");
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Cohort build failed");
    } finally {
      setBuilding(false);
    }
  };

  const runExport = async (slug: string) => {
    setExporting(slug);
    try {
      const { data, error } = await supabase.functions.invoke("activation-export", {
        body: { cohort_slug: slug },
      });
      if (error) throw error;
      const res = data as {
        success?: boolean;
        error?: string;
        row_count?: number;
        holdout?: number;
        activations_recorded?: number;
      };
      if (res?.success) {
        toast.success(
          `Activation file written — ${res.row_count?.toLocaleString()} EIDs` +
            (res.holdout
              ? ` · ${res.holdout.toLocaleString()} withheld as holdout for lift measurement`
              : "") +
            (res.activations_recorded
              ? ` · logged against ${res.activations_recorded} activation grant${res.activations_recorded === 1 ? "" : "s"}`
              : ""),
        );
      }
      else toast.error(res?.error ?? "Export failed");
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Export failed");
    } finally {
      setExporting(null);
    }
  };

  return (
    <div className="space-y-4">
      <Card className="border-primary/20 bg-gradient-to-br from-primary/10 via-card/80 to-card/60 p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <h3 className="flex items-center gap-2 text-sm font-semibold sm:text-base">
              <Users className="h-4 w-4 shrink-0 text-primary" />
              Server-side sonic cohorts
            </h3>
            <p className="mt-1 text-xs text-muted-foreground">
              Built nightly by k-means over Intuizi subject embeddings.{" "}
              {cohorts.length ? `${cohorts.length} cohorts · ${totalMembers.toLocaleString()} subjects.` : ""}
            </p>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={rebuild}
            disabled={building}
            className="shrink-0 gap-2"
          >
            {building ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            Rebuild cohorts
          </Button>
        </div>
      </Card>

      {loading ? (
        <Card className="p-8 text-center">
          <Loader2 className="mx-auto mb-3 h-6 w-6 animate-spin text-muted-foreground" />
          <p className="text-sm text-muted-foreground">Loading cohorts…</p>
        </Card>
      ) : !cohorts.length ? (
        <Card className="p-8 text-center">
          <Users className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            No server cohorts yet — run “Rebuild cohorts” once identifiers have embeddings.
          </p>
        </Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {cohorts.map((c) => (
            <Card key={c.id} className="flex flex-col gap-3 p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">{c.name}</p>
                  <p className="truncate font-mono text-[11px] text-muted-foreground">{c.slug}</p>
                </div>
                <Badge variant={c.export_eligible ? "default" : "secondary"} className="shrink-0 gap-1">
                  {c.export_eligible ? (
                    <ShieldCheck className="h-3 w-3" />
                  ) : (
                    <AlertTriangle className="h-3 w-3" />
                  )}
                  {c.member_count.toLocaleString()}
                </Badge>
              </div>
              {c.narrative && <p className="text-xs text-muted-foreground">{c.narrative}</p>}
              {(() => {
                const last = lastActivation.get(c.slug);
                return (
                  <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                    <Clock className="h-3 w-3 shrink-0" />
                    {last
                      ? `Last activation ${new Date(last.created_at).toLocaleString()} · ${(last.row_count ?? 0).toLocaleString()} EIDs`
                      : "Never activated"}
                  </p>
                );
              })()}
              {!c.export_eligible && (
                <p className="text-[11px] text-amber-500">
                  Below the {MIN_MEMBERS.toLocaleString()}-subject minimum for an Activation file.
                </p>
              )}
              <Button
                size="sm"
                variant={c.export_eligible ? "default" : "outline"}
                disabled={!c.export_eligible || exporting === c.slug}
                onClick={() => runExport(c.slug)}
                className="mt-auto gap-2"
              >
                {exporting === c.slug ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Upload className="h-3.5 w-3.5" />
                )}
                Export Activation file
              </Button>
            </Card>
          ))}
        </div>
      )}

      {exports.length > 0 && (
        <Card className="p-4">
          <h4 className="mb-3 flex items-center gap-2 text-sm font-semibold">
            <FileArchive className="h-4 w-4 text-primary" />
            Recent Activation exports
          </h4>
          <ul className="space-y-2">
            {exports.slice(0, 10).map((x) => (
              <li key={x.id} className="rounded-md border border-border/60 bg-muted/30 p-2">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge
                    variant={x.status === "succeeded" ? "default" : x.status === "failed" ? "destructive" : "secondary"}
                    className="text-[10px]"
                  >
                    {x.status}
                  </Badge>
                  <span className="text-xs font-medium">{x.cohort_slug}</span>
                  <span className="text-[11px] text-muted-foreground">
                    {x.dt} · {(x.row_count ?? 0).toLocaleString()} EIDs · {bytesLabel(x.bytes)}
                  </span>
                </div>
                <p className="mt-1 break-all font-mono text-[10px] text-muted-foreground">{x.object_key}</p>
                {x.error && <p className="mt-1 text-[11px] text-destructive">{x.error}</p>}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
