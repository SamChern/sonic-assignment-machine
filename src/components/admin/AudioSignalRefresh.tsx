// Audio Signal Refresh — the admin-only open-web enrichment control.
//
// One click asks the resolver agent to read open-web metadata about a source,
// write what it means in sonic-semantic terms, embed that description and
// attach it to the source as evidence; then the source is re-scored so the new
// evidence lifts its confidence. Audio is never fetched or streamed — only
// metadata is referenced.
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Globe, Loader2, Radar, ShieldCheck } from "lucide-react";

interface RefreshStep {
  id: string;
  step: string;
  status: string;
  duration_ms: number | null;
}

interface RefreshResult {
  success: boolean;
  error?: string;
  symbol?: string;
  node_id?: string | null;
  attached?: boolean;
  confidence?: number;
  escalated?: boolean;
  usd?: number;
  rescore?: boolean;
  steps?: RefreshStep[];
  node?: { code: string; label: string; proposal?: { description?: string } | null } | null;
  before?: { confidence: number; grounding_level: string | null } | null;
}

interface Props {
  /** Source to enrich. Omit for the dashboard-wide (queue-driven) variant. */
  audioSourceId?: string;
  sourceName?: string;
  /** Called after a successful re-score so the caller can refetch scores. */
  onRefreshed?: () => void;
  compact?: boolean;
}

export const AudioSignalRefresh = ({
  audioSourceId,
  sourceName,
  onRefreshed,
  compact = false,
}: Props) => {
  const { isAdmin } = useAuth();
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState<string | null>(null);
  const [result, setResult] = useState<RefreshResult | null>(null);
  const [after, setAfter] = useState<number | null>(null);

  // Admin-permissioned: the control simply does not exist for other roles.
  if (!isAdmin || !audioSourceId) return null;

  const run = async () => {
    setBusy(true);
    setResult(null);
    setAfter(null);
    setPhase("Reading open-web signal…");
    try {
      const { data, error } = await supabase.functions.invoke("signal-resolver", {
        body: { action: "refresh_source", audio_source_id: audioSourceId },
      });
      if (error) throw error;
      const res = data as RefreshResult;
      if (!res?.success) throw new Error(res?.error ?? "Audio Signal Refresh failed");
      setResult(res);

      if (res.rescore) {
        setPhase("Re-scoring with the new evidence…");
        const { data: scored, error: scoreErr } = await supabase.functions.invoke(
          "analyze-audio",
          {
            body: {
              bypass_cache: true,
              save_results: true,
              sources: [
                {
                  name: sourceName ?? "source",
                  type: "track",
                  audio_source_id: audioSourceId,
                },
              ],
            },
          },
        );
        if (scoreErr) throw scoreErr;
        void scored;
        const { data: fresh } = await supabase
          .from("source_analyses")
          .select("confidence")
          .eq("audio_source_id", audioSourceId)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        const conf = Number(fresh?.confidence ?? 0);
        setAfter(conf);
        const prev = res.before?.confidence ?? 0;
        toast.success(
          `Signal refreshed — confidence ${(prev * 100).toFixed(0)}% → ${(conf * 100).toFixed(0)}%`,
        );
        onRefreshed?.();
      } else {
        toast.info(
          `Open-web signal too weak to use (confidence ${((res.confidence ?? 0) * 100).toFixed(0)}%) — analysis left unchanged.`,
        );
      }
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
      setPhase(null);
    }
  };

  const before = result?.before?.confidence ?? null;

  return (
    <Card className="w-full space-y-2 border-primary/20 bg-card/70 p-3 backdrop-blur">
      <div className="flex flex-wrap items-center gap-2">
        <Radar className="h-4 w-4 text-primary" />
        <h4 className="text-xs font-semibold">Audio Signal Refresh</h4>
        <Badge variant="outline" className="gap-1 px-1.5 py-0 text-[9px]">
          <ShieldCheck className="h-2.5 w-2.5" /> admin
        </Badge>
        <Button
          size="sm"
          className="ml-auto h-7 text-[11px]"
          disabled={busy}
          onClick={run}
        >
          {busy ? (
            <Loader2 className="mr-1 h-3 w-3 animate-spin" />
          ) : (
            <Globe className="mr-1 h-3 w-3" />
          )}
          {busy ? "Refreshing…" : "Enhance signal"}
        </Button>
      </div>

      {!compact && (
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          Sends this source to the open-web resolver agent for extra meaning, then
          re-scores it to raise grounding and confidence. Metadata only — no audio
          is fetched or streamed.
        </p>
      )}

      {phase && <p className="text-[11px] text-primary">{phase}</p>}

      {result && (
        <div className="space-y-1.5 rounded-lg border border-border/60 bg-muted/20 p-2 text-[11px]">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium">
              {result.node?.label ?? result.symbol ?? "open-web signal"}
            </span>
            <Badge variant="outline" className="px-1 py-0 text-[9px]">
              agent confidence {((result.confidence ?? 0) * 100).toFixed(0)}%
            </Badge>
            {result.escalated && (
              <Badge variant="outline" className="px-1 py-0 text-[9px]">escalated</Badge>
            )}
            {result.attached && (
              <Badge variant="outline" className="px-1 py-0 text-[9px]">evidence attached</Badge>
            )}
          </div>
          {result.node?.proposal?.description && (
            <p className="text-muted-foreground">{result.node.proposal.description}</p>
          )}
          {after !== null && (
            <p className="text-muted-foreground">
              Analysis confidence{" "}
              <span className="tabular-nums">
                {((before ?? 0) * 100).toFixed(0)}% → {(after * 100).toFixed(0)}%
              </span>
            </p>
          )}
          {!compact && !!result.steps?.length && (
            <div className="flex flex-wrap gap-1">
              {result.steps.map((s) => (
                <Badge key={s.id} variant="secondary" className="px-1 py-0 text-[9px]">
                  {s.step}
                  {s.status !== "ok" ? ` · ${s.status}` : ""}
                </Badge>
              ))}
            </div>
          )}
        </div>
      )}
    </Card>
  );
};

export default AudioSignalRefresh;
