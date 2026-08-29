import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { ShieldAlert } from "lucide-react";

type Row = {
  kind: string;
  status: string;
  error: string | null;
  details: Record<string, unknown> | null;
  finished_at: string | null;
};

/**
 * Admin-only banner: surfaces a failed nightly retention purge or custody scan,
 * or a scan that came back unclean, so a failure is not only visible to whoever
 * happens to open the compliance card. Never renders identifier values.
 */
export const ComplianceAlert = ({ to = "/admin/health" }: { to?: string }) => {
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const { data } = await supabase
        .from("retention_runs")
        .select("kind,status,error,details,finished_at")
        .order("created_at", { ascending: false })
        .limit(12);
      if (cancelled) return;
      const rows = (data ?? []) as Row[];
      const scan = rows.find((r) => r.kind === "custody_scan");
      const purge = rows.find((r) => r.kind !== "custody_scan" && r.kind !== "suppression_refresh");

      if (scan && (scan.status === "failed" || !scan.details?.clean)) {
        const total = Number((scan.details as Record<string, unknown>)?.violations_total ?? 0);
        setProblem(
          total > 0
            ? `The last EID-custody scan found ${total} raw identifier pattern(s) in Intuizi-sourced tables.`
            : "The last EID-custody scan did not complete cleanly.",
        );
        return;
      }
      if (purge?.status === "failed") {
        setProblem(`The last 90-day retention run failed${purge.error ? `: ${purge.error}` : "."}`);
        return;
      }
      setProblem(null);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!problem) return null;

  return (
    <Alert variant="destructive" className="border-destructive/50">
      <ShieldAlert className="h-4 w-4" />
      <AlertTitle className="text-sm">Compliance attention needed</AlertTitle>
      <AlertDescription className="flex flex-wrap items-center gap-3 text-xs">
        <span>{problem}</span>
        <Button asChild size="sm" variant="outline" className="h-7 text-xs">
          <Link to={to}>Open compliance card</Link>
        </Button>
      </AlertDescription>
    </Alert>
  );
};

export default ComplianceAlert;
