import { useEffect, useState } from "react";
import { AlertTriangle, CalendarClock } from "lucide-react";
import { Card } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";

interface DigestRow {
  label: string;
  value: number | null;
  tab?: string;
  alarming?: boolean;
}

const since = () => new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

/**
 * "What changed since yesterday" for one organization's workspace — the
 * enterprise twin of the admin digest. Each count is isolated so one
 * unreadable table shows an em dash instead of blanking the card, and every
 * tile jumps to the workspace tab where the operator would act on it.
 */
export const WorkspaceDigestCard = ({
  organizationId,
  onPick,
}: {
  organizationId: string;
  onPick?: (tab: string) => void;
}) => {
  const [rows, setRows] = useState<DigestRow[]>([]);

  useEffect(() => {
    let cancelled = false;
    const cutoff = since();

    const count = async (
      table: string,
      build: (q: unknown) => unknown,
    ): Promise<number | null> => {
      try {
        const q = supabase
          .from(table as never)
          .select("*", { count: "exact", head: true })
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .eq("organization_id", organizationId) as any;
        const { count: c, error } = await (build(q) as Promise<{
          count: number | null;
          error: unknown;
        }>);
        if (error) throw error;
        return c ?? 0;
      } catch (err) {
        console.error(`workspace digest ${table} failed`, err);
        return null;
      }
    };

    (async () => {
      const [added, scored, syncs, failed] = await Promise.all([
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        count("enterprise_records", (q) => (q as any).gte("created_at", cutoff)),
        count("enterprise_records", (q) =>
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (q as any).eq("analysis_status", "scored").gte("updated_at", cutoff),
        ),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        count("org_intuizi_sync_runs", (q) => (q as any).gte("created_at", cutoff)),
        count("enterprise_records", (q) =>
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (q as any).not("analysis_error", "is", null).gte("updated_at", cutoff),
        ),
      ]);
      if (cancelled) return;
      setRows([
        { label: "Records added", value: added, tab: "data" },
        { label: "Records scored", value: scored, tab: "analyses" },
        { label: "Data syncs", value: syncs, tab: "data" },
        {
          label: "Scoring errors",
          value: failed,
          tab: "analyses",
          alarming: (failed ?? 0) > 0,
        },
      ]);
    })();

    return () => {
      cancelled = true;
    };
  }, [organizationId]);

  const display = rows.length
    ? rows
    : [
        { label: "Records added", value: null },
        { label: "Records scored", value: null },
        { label: "Data syncs", value: null },
        { label: "Scoring errors", value: null },
      ];

  return (
    <Card className="border-border/60 bg-card/70 p-4 backdrop-blur-sm">
      <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-muted-foreground">
        <CalendarClock className="h-4 w-4" />
        What changed since yesterday
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {display.map((r) => {
          const inner = (
            <div className="h-full rounded-lg border border-border/50 bg-background/40 p-3 text-left">
              <p className="flex items-center gap-1 text-xs text-muted-foreground">
                {r.alarming && <AlertTriangle className="h-3 w-3 text-amber-400" />}
                {r.label}
              </p>
              <p
                className={`text-xl font-semibold ${
                  r.alarming ? "text-amber-300" : "text-foreground"
                }`}
              >
                {r.value === null ? "—" : r.value.toLocaleString()}
              </p>
            </div>
          );
          return r.tab && onPick ? (
            <button
              key={r.label}
              type="button"
              onClick={() => onPick(r.tab as string)}
              className="transition-smooth hover:opacity-90"
            >
              {inner}
            </button>
          ) : (
            <div key={r.label}>{inner}</div>
          );
        })}
      </div>
    </Card>
  );
};

export default WorkspaceDigestCard;
