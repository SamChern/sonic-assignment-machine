import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Bug, RefreshCw, Loader2 } from "lucide-react";

/** Prefixes the scheduled ingest scans (mirrors INGEST_PREFIXES on the backend). */
const KNOWN_PREFIXES = [
  "ctv/",
  "apps/",
  "visitation/",
  "demographics/",
  "origin/",
  "Activations/",
];

interface FileRow {
  id: string;
  object_key: string;
  report_type: string | null;
  status: string;
  total_rows: number | null;
  processed_rows: number | null;
  failed_rows: number | null;
  partition_date: string | null;
  size_bytes: number | null;
  error_message: string | null;
  discovered_at: string;
  started_at: string | null;
  finished_at: string | null;
}

interface RunSummary {
  files_processed?: number;
  files_failed?: number;
  rows_read?: number;
  identifiers_scored?: number;
  probe_only?: boolean;
  errors?: string[];
}

const detectPrefix = (key: string) => {
  const lower = key.toLowerCase();
  const hit = KNOWN_PREFIXES.find((p) => lower.startsWith(p.toLowerCase()));
  if (hit) return hit;
  const dir = key.includes("/") ? `${key.split("/")[0]}/` : "(root)";
  return dir;
};

const isMixedPrefix = (prefix: string) =>
  prefix.toLowerCase() === "activations/";

const relative = (iso: string | null) => {
  if (!iso) return "never";
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 48) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
};

const bytes = (n: number | null) => {
  if (!n) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1048576).toFixed(1)} MB`;
};

const IngestDebugPanel = () => {
  const [files, setFiles] = useState<FileRow[]>([]);
  const [summary, setSummary] = useState<RunSummary | null>(null);
  const [lastRunAt, setLastRunAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const [filesRes, stateRes] = await Promise.all([
      supabase
        .from("intuizi_ingest_files")
        .select(
          "id, object_key, report_type, status, total_rows, processed_rows, failed_rows, partition_date, size_bytes, error_message, discovered_at, started_at, finished_at",
        )
        .order("discovered_at", { ascending: false })
        .limit(20),
      supabase
        .from("intuizi_ingest_state")
        .select("last_run_at, last_run_summary")
        .eq("id", "singleton")
        .maybeSingle(),
    ]);
    setFiles((filesRes.data as FileRow[]) ?? []);
    setSummary((stateRes.data?.last_run_summary as RunSummary) ?? null);
    setLastRunAt(stateRes.data?.last_run_at ?? null);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const prefixCounts = files.reduce<Record<string, number>>((acc, f) => {
    const p = detectPrefix(f.object_key);
    acc[p] = (acc[p] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <Card className="p-5 space-y-4 bg-card/60 border-border">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <Bug className="h-4 w-4 text-primary" />
          <div>
            <h2 className="font-semibold">Ingestion debug</h2>
            <p className="text-sm text-muted-foreground">
              Last objects seen, prefix detection, inferred report types and row counts
            </p>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
          {loading ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <RefreshCw className="h-3 w-3" />
          )}
          <span className="ml-2">Refresh</span>
        </Button>
      </div>

      {/* ---- Last run rollup ------------------------------------------- */}
      <div className="rounded-md border border-border bg-muted/30 p-3">
        <div className="flex flex-wrap gap-x-6 gap-y-2">
          {[
            { label: "Last run", value: relative(lastRunAt) },
            { label: "Files processed", value: String(summary?.files_processed ?? 0) },
            { label: "Files failed", value: String(summary?.files_failed ?? 0) },
            { label: "Rows read", value: String(summary?.rows_read ?? 0) },
            { label: "Identifiers scored", value: String(summary?.identifiers_scored ?? 0) },
            { label: "Mode", value: summary?.probe_only ? "probe only" : "ingest" },
          ].map((m) => (
            <div key={m.label}>
              <p className="text-xs text-muted-foreground">{m.label}</p>
              <p className="text-sm font-medium">{m.value}</p>
            </div>
          ))}
        </div>
        {summary?.errors?.length ? (
          <ul className="mt-3 space-y-1 border-t border-border pt-2">
            {summary.errors.slice(0, 5).map((e, i) => (
              <li key={i} className="text-xs font-mono text-destructive break-all">
                {e}
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      {/* ---- Detected prefixes ---------------------------------------- */}
      <div className="space-y-2">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">
          Detected prefixes
        </p>
        <div className="flex flex-wrap gap-2">
          {Object.keys(prefixCounts).length === 0 && (
            <span className="text-xs text-muted-foreground">No objects recorded yet.</span>
          )}
          {Object.entries(prefixCounts).map(([prefix, count]) => (
            <Badge key={prefix} variant="outline" className="font-mono text-xs">
              {prefix} · {count}
              {isMixedPrefix(prefix) && (
                <span className="ml-1 text-muted-foreground">(mixed)</span>
              )}
            </Badge>
          ))}
        </div>
      </div>

      {/* ---- Object ledger -------------------------------------------- */}
      <div className="space-y-2">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">
          Last ingested objects
        </p>
        {files.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            Nothing in the ingest ledger yet.
          </p>
        ) : (
          <div className="space-y-2">
            {files.map((f) => {
              const prefix = detectPrefix(f.object_key);
              return (
                <div
                  key={f.id}
                  className="rounded-md border border-border bg-muted/20 p-3 space-y-1"
                >
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <p className="text-xs font-mono break-all">{f.object_key}</p>
                    <Badge variant="outline" className="text-xs shrink-0">
                      {f.status}
                    </Badge>
                  </div>
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                    <span>
                      prefix <span className="font-mono text-foreground">{prefix}</span>
                      {isMixedPrefix(prefix) ? " (type from filename)" : ""}
                    </span>
                    <span>
                      type{" "}
                      <span className="font-mono text-foreground">
                        {f.report_type ?? "unresolved"}
                      </span>
                    </span>
                    {f.partition_date && <span>dt {f.partition_date}</span>}
                    <span>{bytes(f.size_bytes)}</span>
                    <span>
                      rows {f.processed_rows ?? 0}/{f.total_rows ?? 0}
                      {f.failed_rows ? ` · ${f.failed_rows} failed` : ""}
                    </span>
                    <span
                      title={
                        f.finished_at ?? f.started_at ?? f.discovered_at
                          ? new Date(
                              f.finished_at ?? f.started_at ?? f.discovered_at,
                            ).toLocaleString()
                          : undefined
                      }
                    >
                      {relative(f.finished_at ?? f.started_at ?? f.discovered_at)}
                    </span>
                  </div>
                  {f.error_message && (
                    <p className="text-xs font-mono text-destructive break-all">
                      {f.error_message}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </Card>
  );
};

export default IngestDebugPanel;
