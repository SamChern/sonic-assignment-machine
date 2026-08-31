// Admin queue: which audio signals need an open-web refresh, and in what order.
//
// Every analysed source lands here with its status (grounding level), its
// confidence and its last analysis time, so an admin can plan enhancement work
// instead of hunting source by source. Each row refreshes in place: the resolver
// agent enriches it, the source is re-scored, and the row shows the delta.
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { ArrowUpRight, Globe, Loader2, Radar, RefreshCw, ShieldCheck } from "lucide-react";
import { useAudioSignalRefresh } from "@/hooks/useAudioSignalRefresh";

interface QueueRow {
  id: string;
  audio_source_id: string;
  source_name: string;
  confidence: number;
  grounding_level: string | null;
  created_at: string;
}

type Lens = "all" | "ungrounded" | "low" | "stale";

const LENSES: { key: Lens; label: string; hint: string }[] = [
  { key: "low", label: "Low confidence", hint: "under the confidence floor" },
  { key: "ungrounded", label: "Ungrounded", hint: "no measured audio evidence" },
  { key: "stale", label: "Stale", hint: "not scored in 30+ days" },
  { key: "all", label: "All", hint: "every analysed source" },
];

const LOW_CONFIDENCE = 0.6;
const STALE_DAYS = 30;

const groundingTone = (level: string | null) => {
  switch ((level ?? "").toLowerCase()) {
    case "grounded":
      return "border-primary/40 bg-primary/10 text-primary";
    case "partial":
    case "inferred":
      return "border-amber-500/40 bg-amber-500/10 text-amber-500";
    default:
      return "border-destructive/40 bg-destructive/10 text-destructive";
  }
};

export const AudioSignalQueue = ({ pageSize = 25 }: { pageSize?: number }) => {
  const { isAdmin } = useAuth();
  const { refresh, busyId, phase } = useAudioSignalRefresh();
  const [rows, setRows] = useState<QueueRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [lens, setLens] = useState<Lens>("low");
  const [query, setQuery] = useState("");
  const [deltas, setDeltas] = useState<Record<string, { before: number; after: number | null }>>({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // Newest analysis per source, cheapest-first ordering by confidence.
      const { data, error } = await supabase
        .from("source_analyses")
        .select("id, audio_source_id, source_name, confidence, grounding_level, created_at")
        .not("audio_source_id", "is", null)
        .order("confidence", { ascending: true })
        .limit(400);
      if (error) throw error;
      const seen = new Set<string>();
      const deduped: QueueRow[] = [];
      for (const r of (data ?? []) as QueueRow[]) {
        if (seen.has(r.audio_source_id)) continue;
        seen.add(r.audio_source_id);
        deduped.push(r);
      }
      setRows(deduped);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isAdmin) void load();
  }, [isAdmin, load]);

  const staleCutoff = useMemo(
    () => Date.now() - STALE_DAYS * 24 * 60 * 60 * 1000,
    [],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      if (q && !(r.source_name ?? "").toLowerCase().includes(q)) return false;
      switch (lens) {
        case "low":
          return Number(r.confidence ?? 0) < LOW_CONFIDENCE;
        case "ungrounded":
          return (r.grounding_level ?? "").toLowerCase() !== "grounded";
        case "stale":
          return new Date(r.created_at).getTime() < staleCutoff;
        default:
          return true;
      }
    });
  }, [rows, lens, query, staleCutoff]);

  const counts = useMemo(
    () => ({
      all: rows.length,
      low: rows.filter((r) => Number(r.confidence ?? 0) < LOW_CONFIDENCE).length,
      ungrounded: rows.filter((r) => (r.grounding_level ?? "").toLowerCase() !== "grounded").length,
      stale: rows.filter((r) => new Date(r.created_at).getTime() < staleCutoff).length,
    }),
    [rows, staleCutoff],
  );

  if (!isAdmin) return null;

  const runRow = async (row: QueueRow) => {
    const res = await refresh(row.audio_source_id, row.source_name);
    if (!res) return;
    setDeltas((d) => ({
      ...d,
      [row.audio_source_id]: {
        before: res.before?.confidence ?? Number(row.confidence ?? 0),
        after: res.after ?? null,
      },
    }));
    if (res.rescore) void load();
  };

  return (
    <Card className="space-y-3 border-primary/20 bg-card/70 p-4 backdrop-blur">
      <div className="flex flex-wrap items-center gap-2">
        <Radar className="h-4 w-4 text-primary" />
        <h3 className="text-sm font-semibold">Audio signals to refresh</h3>
        <Badge variant="outline" className="gap-1 text-[10px]">
          <ShieldCheck className="h-2.5 w-2.5" /> admin
        </Badge>
        <Button size="sm" variant="ghost" className="ml-auto h-7 text-[11px]" onClick={load}>
          {loading ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <RefreshCw className="h-3 w-3" />
          )}
          <span className="ml-1 hidden sm:inline">Reload</span>
        </Button>
      </div>

      <p className="text-[11px] text-muted-foreground">
        Enhancement backlog, weakest first. Refreshing sends the source to the
        open-web resolver agent, attaches what it learns as evidence and re-scores
        it. Metadata only — no audio is fetched or streamed.
      </p>

      <div className="flex flex-wrap items-center gap-1.5">
        {LENSES.map((l) => (
          <button
            key={l.key}
            type="button"
            title={l.hint}
            onClick={() => setLens(l.key)}
            className={`rounded-full border px-2.5 py-1 text-[10px] transition-colors ${
              lens === l.key
                ? "border-primary bg-primary/10 text-primary"
                : "border-border/60 text-muted-foreground hover:border-primary/40"
            }`}
          >
            {l.label}
            <span className="ml-1 tabular-nums opacity-70">{counts[l.key]}</span>
          </button>
        ))}
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search sources…"
          className="h-7 w-full max-w-[14rem] text-xs sm:ml-auto"
        />
      </div>

      {phase && <p className="text-[11px] text-primary">{phase}</p>}

      <div className="-mx-1 overflow-x-auto">
        <table className="w-full min-w-[34rem] border-collapse text-[11px]">
          <thead>
            <tr className="text-left text-[10px] uppercase tracking-wide text-muted-foreground">
              <th className="px-2 py-1.5 font-medium">Source</th>
              <th className="px-2 py-1.5 font-medium">Status</th>
              <th className="px-2 py-1.5 font-medium">Confidence</th>
              <th className="px-2 py-1.5 font-medium">Last scored</th>
              <th className="px-2 py-1.5 text-right font-medium">Action</th>
            </tr>
          </thead>
          <tbody>
            {filtered.slice(0, pageSize).map((r) => {
              const delta = deltas[r.audio_source_id];
              const conf = Number(r.confidence ?? 0);
              return (
                <tr key={r.audio_source_id} className="border-t border-border/50">
                  <td className="max-w-[16rem] px-2 py-2">
                    <span className="block truncate font-medium">{r.source_name}</span>
                  </td>
                  <td className="px-2 py-2">
                    <Badge
                      variant="outline"
                      className={`px-1.5 py-0 text-[9px] ${groundingTone(r.grounding_level)}`}
                    >
                      {r.grounding_level ?? "ungrounded"}
                    </Badge>
                  </td>
                  <td className="px-2 py-2 tabular-nums">
                    {(conf * 100).toFixed(0)}%
                    {delta?.after !== null && delta?.after !== undefined && (
                      <span className="ml-1 inline-flex items-center text-primary">
                        <ArrowUpRight className="h-3 w-3" />
                        {(delta.after * 100).toFixed(0)}%
                      </span>
                    )}
                  </td>
                  <td className="px-2 py-2 text-muted-foreground">
                    {new Date(r.created_at).toLocaleDateString()}
                  </td>
                  <td className="px-2 py-2 text-right">
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-6 px-2 text-[10px]"
                      disabled={busyId !== null}
                      onClick={() => runRow(r)}
                    >
                      {busyId === r.audio_source_id ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <Globe className="mr-1 h-3 w-3" />
                      )}
                      {busyId === r.audio_source_id ? "" : "Refresh"}
                    </Button>
                  </td>
                </tr>
              );
            })}
            {!filtered.length && !loading && (
              <tr>
                <td colSpan={5} className="px-2 py-4 text-center text-muted-foreground">
                  Nothing in this lens — the backlog is clear.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {filtered.length > pageSize && (
        <p className="text-[10px] text-muted-foreground">
          Showing {pageSize} of {filtered.length} — refine with search or a tighter lens.
        </p>
      )}
    </Card>
  );
};

export default AudioSignalQueue;
