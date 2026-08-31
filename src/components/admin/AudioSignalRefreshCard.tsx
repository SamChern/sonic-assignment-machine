// Admin dashboard surface for Audio Signal Refresh.
//
// Lists the analysed sources with the weakest confidence and lets the admin
// send any of them to the open-web resolver agent, then re-score — the same
// action offered inside a SonicSIM analysis, here as a triage queue.
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Loader2, Radar, RefreshCw } from "lucide-react";
import { AudioSignalRefresh } from "@/components/admin/AudioSignalRefresh";

interface WeakRow {
  audio_source_id: string;
  source_name: string;
  confidence: number;
  grounding_level: string | null;
}

export const AudioSignalRefreshCard = ({ limit = 6 }: { limit?: number }) => {
  const { isAdmin } = useAuth();
  const [rows, setRows] = useState<WeakRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<WeakRow | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("source_analyses")
        .select("audio_source_id, source_name, confidence, grounding_level")
        .not("audio_source_id", "is", null)
        .order("confidence", { ascending: true })
        .limit(limit);
      if (error) throw error;
      const next = (data ?? []) as WeakRow[];
      setRows(next);
      setSelected((cur) => cur ?? next[0] ?? null);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [limit]);

  useEffect(() => {
    if (isAdmin) void load();
  }, [isAdmin, load]);

  if (!isAdmin) return null;

  return (
    <Card className="space-y-3 border-primary/20 bg-card/70 p-4 backdrop-blur">
      <div className="flex flex-wrap items-center gap-2">
        <Radar className="h-4 w-4 text-primary" />
        <h3 className="text-sm font-semibold">Audio Signal Refresh</h3>
        <Badge variant="outline" className="text-[10px]">open-web enrichment</Badge>
        <Button size="sm" variant="ghost" className="ml-auto h-7 text-[11px]" onClick={load}>
          {loading ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <RefreshCw className="h-3 w-3" />
          )}
        </Button>
      </div>

      <p className="text-[11px] text-muted-foreground">
        Weakest-confidence analyses first. Pick one and enhance it: the resolver
        agent reads open-web metadata, attaches the meaning as evidence and the
        source is re-scored.
      </p>

      <div className="flex flex-wrap gap-1.5">
        {rows.map((r) => (
          <button
            key={r.audio_source_id}
            type="button"
            onClick={() => setSelected(r)}
            className={`rounded-full border px-2 py-1 text-[10px] transition-colors ${
              selected?.audio_source_id === r.audio_source_id
                ? "border-primary bg-primary/10 text-primary"
                : "border-border/60 text-muted-foreground hover:border-primary/40"
            }`}
          >
            <span className="max-w-[14rem] truncate align-middle">{r.source_name}</span>
            <span className="ml-1 tabular-nums opacity-70">
              {(Number(r.confidence ?? 0) * 100).toFixed(0)}%
            </span>
          </button>
        ))}
        {!rows.length && !loading && (
          <span className="text-[11px] text-muted-foreground">No analysed sources yet.</span>
        )}
      </div>

      {selected && (
        <AudioSignalRefresh
          audioSourceId={selected.audio_source_id}
          sourceName={selected.source_name}
          onRefreshed={load}
          compact
        />
      )}
    </Card>
  );
};

export default AudioSignalRefreshCard;
