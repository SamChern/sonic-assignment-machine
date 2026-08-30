import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, CalendarClock } from "lucide-react";
import { Card } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";

interface DigestRow {
  label: string;
  value: number | null;
  to?: string;
  alarming?: boolean;
}

const since = () => new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

/**
 * Step 16c — "what changed since yesterday".
 *
 * Four counts an admin actually acts on. Each is isolated: one unreadable table
 * shows an em dash instead of blanking the card.
 */
export const AdminDigestCard = () => {
  const [rows, setRows] = useState<DigestRow[]>([]);

  useEffect(() => {
    let cancelled = false;
    const cutoff = since();

    const count = async (
      table: string,
      build: (q: ReturnType<typeof supabase.from>) => unknown,
    ): Promise<number | null> => {
      try {
        // deno-lint-ignore no-explicit-any
        const q = supabase.from(table as never).select("*", { count: "exact", head: true }) as any;
        const { count: c, error } = await (build(q) as Promise<{
          count: number | null;
          error: unknown;
        }>);
        if (error) throw error;
        return c ?? 0;
      } catch (err) {
        console.error(`digest ${table} failed`, err);
        return null;
      }
    };

    (async () => {
      const [files, analyses, failures, unresolved] = await Promise.all([
        count("intuizi_ingest_files", (q) =>
          // deno-lint-ignore no-explicit-any
          (q as any).eq("status", "loaded").gte("updated_at", cutoff),
        ),
        // deno-lint-ignore no-explicit-any
        count("source_analyses", (q) => (q as any).gte("created_at", cutoff)),
        // deno-lint-ignore no-explicit-any
        count("analysis_jobs", (q) => (q as any).eq("status", "failed").gte("updated_at", cutoff)),
        // deno-lint-ignore no-explicit-any
        count("resolution_queue", (q) => (q as any).eq("status", "pending")),
      ]);
      if (cancelled) return;
      setRows([
        { label: "Files loaded", value: files, to: "/admin/pipeline" },
        { label: "New analyses", value: analyses, to: "/admin/semantic" },
        {
          label: "Failed jobs",
          value: failures,
          to: "/admin/compatibility",
          alarming: (failures ?? 0) > 0,
        },
        {
          label: "Unresolved symbols",
          value: unresolved,
          to: "/admin/pipeline",
          alarming: (unresolved ?? 0) > 0,
        },
      ]);
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <Card className="border-border/60 bg-card/70 p-4 backdrop-blur-sm">
      <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-muted-foreground">
        <CalendarClock className="h-4 w-4" />
        What changed since yesterday
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {(rows.length
          ? rows
          : [
              { label: "Files loaded", value: null },
              { label: "New analyses", value: null },
              { label: "Failed jobs", value: null },
              { label: "Unresolved symbols", value: null },
            ]
        ).map((r) => {
          const inner = (
            <div className="rounded-lg border border-border/50 bg-background/40 p-3">
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
          return r.to ? (
            <Link key={r.label} to={r.to} className="transition-smooth hover:opacity-90">
              {inner}
            </Link>
          ) : (
            <div key={r.label}>{inner}</div>
          );
        })}
      </div>
    </Card>
  );
};

export default AdminDigestCard;
