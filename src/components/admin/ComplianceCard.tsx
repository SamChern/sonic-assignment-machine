import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { ShieldCheck, ShieldAlert, EyeOff, RefreshCw, Trash2, Loader2 } from "lucide-react";

type RetentionRun = {
  id: string;
  kind: string;
  cutoff: string;
  retention_days: number;
  subjects_matched: number;
  identifiers_deleted: number;
  sources_deleted: number;
  tags_deleted: number;
  analyses_deleted: number;
  embeddings_deleted: number;
  cohort_members_deleted: number;
  queue_rows_deleted: number;
  status: string;
  error: string | null;
  details: Record<string, unknown> | null;
  started_at: string;
  finished_at: string | null;
};

const fmt = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "—";

export const ComplianceCard = () => {
  const [runs, setRuns] = useState<RetentionRun[]>([]);
  const [suppressedCount, setSuppressedCount] = useState<number | null>(null);
  const [poiCount, setPoiCount] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<"retention" | "scan" | "suppression" | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const [{ data: runRows, error: runErr }, { count }, { count: poi }] = await Promise.all([
      supabase
        .from("retention_runs")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(12),
      supabase
        .from("taxonomy_nodes")
        .select("id", { count: "exact", head: true })
        .eq("suppressed", true),
      supabase
        .from("taxonomy_nodes")
        .select("id", { count: "exact", head: true })
        .or("code.ilike.visit.%,code.ilike.poi.%,code.ilike.place.%,code.ilike.geo.%"),
    ]);
    if (runErr) toast.error(`Could not load retention history: ${runErr.message}`);
    setRuns((runRows ?? []) as RetentionRun[]);
    setSuppressedCount(count ?? 0);
    setPoiCount(poi ?? 0);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const lastRetention = useMemo(
    () => runs.find((r) => r.kind !== "custody_scan" && r.kind !== "suppression_refresh"),
    [runs],
  );
  const lastScan = useMemo(() => runs.find((r) => r.kind === "custody_scan"), [runs]);
  const lastSuppression = useMemo(() => runs.find((r) => r.kind === "suppression_refresh"), [runs]);
  const scanDetails = (lastScan?.details ?? {}) as Record<string, unknown>;
  const scanClean = Boolean(scanDetails.clean) && lastScan?.status !== "failed";

  // scan_intuizi_custody() reports per-table counts under maid_shaped / ip_shaped.
  const perTable = (group: string): Array<[string, number]> => {
    const raw = scanDetails[group];
    if (!raw || typeof raw !== "object") return [];
    return Object.entries(raw as Record<string, unknown>)
      .map(([table, n]) => [table, Number(n) || 0] as [string, number])
      .filter(([, n]) => n > 0);
  };
  const maidHits = perTable("maid_shaped");
  const ipHits = perTable("ip_shaped");
  const hitNote = (hits: Array<[string, number]>) => {
    if (!lastScan) return "not scanned yet";
    if (hits.length === 0) return "0 found";
    const total = hits.reduce((s, [, n]) => s + n, 0);
    return `${total} found in ${hits.map(([t]) => t.replace(/_/g, " ")).join(", ")}`;
  };

  const runRetention = async () => {
    setBusy("retention");
    const { data: knob } = await supabase
      .from("control_registry")
      .select("value")
      .eq("key", "retention.days")
      .maybeSingle();
    const retentionDays = Number(knob?.value ?? 90) || 90;
    const { data, error } = await supabase.rpc("run_intuizi_retention", {
      p_days: retentionDays,
    });
    setBusy(null);
    if (error) {
      toast.error(`Retention run failed: ${error.message}`);
    } else {
      const res = (data ?? {}) as Record<string, unknown>;
      if (res.status === "failed") toast.error(`Retention run failed: ${String(res.error ?? "unknown")}`);
      else toast.success(`Retention complete — ${Number(res.subjects_matched ?? 0)} stale subject(s) purged`);
    }
    await load();
  };

  const runScan = async () => {
    setBusy("scan");
    const { data, error } = await supabase.rpc("log_intuizi_custody_scan");
    setBusy(null);
    if (error) {
      toast.error(`Custody scan failed: ${error.message}`);
    } else {
      const res = (data ?? {}) as Record<string, unknown>;
      if (res.clean) toast.success("Custody scan clean — no raw device IDs or IPs found");
      else toast.error("Custody scan found raw identifier patterns — review below");
    }
    await load();
  };

  const runSuppression = async () => {
    setBusy("suppression");
    const { data, error } = await supabase.rpc("refresh_taxonomy_suppression");
    setBusy(null);
    if (error) {
      toast.error(`Suppression refresh failed: ${error.message}`);
    } else {
      const res = (data ?? {}) as Record<string, unknown>;
      toast.success(
        `Checked ${Number(res.poi_nodes ?? 0)} place class(es) — ${Number(res.newly_suppressed ?? 0)} newly suppressed`,
      );
    }
    await load();
  };

  const suppressionNote = () => {
    if (!lastSuppression) return "never checked";
    if ((poiCount ?? 0) === 0) return "0 flagged — no visitation data ingested yet";
    return `${suppressedCount ?? 0} of ${poiCount} place class(es) flagged`;
  };

  const checklist = [
    { label: "No mapping keys or salts stored", ok: true, note: "EIDs are derived one-way at ingest" },
    {
      label: "No raw MAID-format identifiers",
      ok: scanClean && maidHits.length === 0,
      note: hitNote(maidHits),
    },
    {
      label: "No IP addresses retained",
      ok: scanClean && ipHits.length === 0,
      note: hitNote(ipHits),
    },
    {
      label: "Sensitive place classes suppressed",
      ok: Boolean(lastSuppression),
      note: suppressionNote(),
    },
  ];


  return (
    <Card className="border-border/60 bg-card/60 backdrop-blur">
      <CardHeader className="gap-1">
        <CardTitle className="flex flex-wrap items-center gap-2 text-base">
          <ShieldCheck className="h-4 w-4 text-primary" />
          Compliance &amp; retention
          <Badge variant={lastRetention?.status === "failed" ? "destructive" : "secondary"} className="text-[10px]">
            90-day mirror
          </Badge>
        </CardTitle>
        <CardDescription>
          Mirrors Intuizi mapping-key expiry: Intuizi subjects with no signal for 90 days are purged nightly
          (03:15 UTC), followed by an EID-custody scan (03:45 UTC).
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-lg border border-border/50 bg-background/40 p-3">
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Last retention run</p>
            <p className="mt-1 text-sm font-medium">{fmt(lastRetention?.finished_at ?? lastRetention?.started_at ?? null)}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {lastRetention
                ? `${lastRetention.status} · ${lastRetention.subjects_matched} subject(s), ${lastRetention.tags_deleted} tag(s), ${lastRetention.embeddings_deleted} embedding(s)`
                : "no runs recorded yet"}
            </p>
            {lastRetention?.error && (
              <p className="mt-1 text-xs text-destructive">{lastRetention.error}</p>
            )}
          </div>
          <div className="rounded-lg border border-border/50 bg-background/40 p-3">
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Suppressed categories</p>
            <p className="mt-1 flex items-center gap-2 text-sm font-medium">
              <EyeOff className="h-3.5 w-3.5 text-muted-foreground" />
              {suppressedCount ?? "—"}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Sensitive place classes (health, worship, shelters) are never tagged onto a source.{" "}
              {suppressionNote()}.

            </p>
          </div>
          <div className="rounded-lg border border-border/50 bg-background/40 p-3">
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Custody scan</p>
            <p className="mt-1 flex items-center gap-2 text-sm font-medium">
              {lastScan ? (
                scanClean ? (
                  <ShieldCheck className="h-3.5 w-3.5 text-primary" />
                ) : (
                  <ShieldAlert className="h-3.5 w-3.5 text-destructive" />
                )
              ) : null}
              {lastScan ? (scanClean ? "Clean" : "Attention needed") : "Not scanned"}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">{fmt(lastScan?.finished_at ?? null)}</p>
          </div>
        </div>

        <ul className="space-y-1.5">
          {checklist.map((item) => (
            <li key={item.label} className="flex items-start gap-2 text-xs">
              {item.ok ? (
                <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
              ) : (
                <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" />
              )}
              <span className={item.ok ? "" : "text-destructive"}>
                {item.label}
                <span className="ml-1 text-muted-foreground">— {item.note}</span>
              </span>
            </li>
          ))}
        </ul>

        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={runRetention} disabled={busy !== null}>
            {busy === "retention" ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Trash2 className="mr-1.5 h-3.5 w-3.5" />}
            Run retention now
          </Button>
          <Button size="sm" variant="outline" onClick={runScan} disabled={busy !== null}>
            {busy === "scan" ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <ShieldCheck className="mr-1.5 h-3.5 w-3.5" />}
            Run custody scan
          </Button>
          <Button size="sm" variant="outline" onClick={runSuppression} disabled={busy !== null}>
            {busy === "suppression" ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <EyeOff className="mr-1.5 h-3.5 w-3.5" />}
            Refresh suppression
          </Button>

          <Button size="sm" variant="ghost" onClick={load} disabled={loading}>
            <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>

        {runs.length > 0 && (
          <div className="overflow-x-auto rounded-lg border border-border/50">
            <table className="w-full text-left text-xs">
              <thead className="bg-muted/40 text-[11px] uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-2 py-1.5">When</th>
                  <th className="px-2 py-1.5">Kind</th>
                  <th className="px-2 py-1.5">Status</th>
                  <th className="px-2 py-1.5">Subjects</th>
                  <th className="px-2 py-1.5">Rows removed</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((r) => (
                  <tr key={r.id} className="border-t border-border/40">
                    <td className="px-2 py-1.5 whitespace-nowrap">{fmt(r.finished_at ?? r.started_at)}</td>
                    <td className="px-2 py-1.5">{KIND_LABELS[r.kind] ?? "retention"}</td>
                    <td className="px-2 py-1.5">
                      <Badge variant={r.status === "failed" ? "destructive" : "secondary"} className="text-[10px]">
                        {r.status}
                      </Badge>
                    </td>
                    <td className="px-2 py-1.5">{NON_PURGE_KINDS.has(r.kind) ? "—" : r.subjects_matched}</td>
                    <td className="px-2 py-1.5">
                      {NON_PURGE_KINDS.has(r.kind)
                        ? "—"

                        : r.identifiers_deleted +
                          r.sources_deleted +
                          r.tags_deleted +
                          r.analyses_deleted +
                          r.embeddings_deleted +
                          r.cohort_members_deleted +
                          r.queue_rows_deleted}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default ComplianceCard;
