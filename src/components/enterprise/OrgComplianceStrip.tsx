import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ShieldCheck } from "lucide-react";

interface Summary {
  retention_days: number;
  last_run_at: string | null;
  last_status: string | null;
  org_sources_total: number;
  org_sources_recent: number;
}

const fmt = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "—";

/**
 * Read-only, org-scoped compliance summary for enterprise members.
 * Backed by `org_retention_summary`, which checks org membership and returns
 * aggregates only — never a subject key or another organization's rows.
 */
const OrgComplianceStrip = ({ organizationId }: { organizationId: string }) => {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data, error: rpcErr } = await supabase.rpc("org_retention_summary", {
      _org: organizationId,
    });
    if (rpcErr) {
      setError(rpcErr.message);
      return;
    }
    setError(null);
    const rows = (data ?? []) as unknown as Summary[];
    setSummary(rows[0] ?? null);
  }, [organizationId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (error) return null;

  return (
    <Card className="border-border/60 bg-card/60 backdrop-blur">
      <CardHeader className="gap-1 pb-3">
        <CardTitle className="flex flex-wrap items-center gap-2 text-sm">
          <ShieldCheck className="h-4 w-4 text-primary" />
          Data retention
          <Badge variant="secondary" className="text-[10px]">
            {summary ? `${summary.retention_days}-day window` : "loading"}
          </Badge>
        </CardTitle>
        <CardDescription className="text-xs">
          Signals with no activity inside the retention window are purged nightly across the
          platform. Purge controls are managed by the SonicSIM team.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3 pt-0 sm:grid-cols-3">
        <div className="rounded-lg border border-border/50 bg-background/40 p-3">
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Last purge</p>
          <p className="mt-1 text-sm font-medium">{fmt(summary?.last_run_at ?? null)}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {summary?.last_status ?? "no runs recorded yet"}
          </p>
        </div>
        <div className="rounded-lg border border-border/50 bg-background/40 p-3">
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
            Your sources
          </p>
          <p className="mt-1 text-sm font-medium">{summary?.org_sources_total ?? "—"}</p>
          <p className="mt-1 text-xs text-muted-foreground">in this workspace</p>
        </div>
        <div className="rounded-lg border border-border/50 bg-background/40 p-3">
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
            Inside window
          </p>
          <p className="mt-1 text-sm font-medium">{summary?.org_sources_recent ?? "—"}</p>
          <p className="mt-1 text-xs text-muted-foreground">not eligible for purge</p>
        </div>
      </CardContent>
    </Card>
  );
};

export default OrgComplianceStrip;
