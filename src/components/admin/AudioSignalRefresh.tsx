// Audio Signal Refresh — the admin-only open-web enrichment control shown
// inside a SonicSIM analysis.
//
// One click asks the resolver agent to read open-web metadata about the source,
// attach the resolved meaning as evidence and re-score it, so grounding and
// confidence rise. Audio is never fetched or streamed — metadata only.
import { useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Globe, Loader2, Radar, ShieldCheck } from "lucide-react";
import { useAudioSignalRefresh, type RefreshOutcome } from "@/hooks/useAudioSignalRefresh";

interface Props {
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
  const { refresh, busy, phase } = useAudioSignalRefresh();
  const [result, setResult] = useState<RefreshOutcome | null>(null);

  // Admin-permissioned: the control simply does not exist for other roles.
  if (!isAdmin || !audioSourceId) return null;

  const run = async () => {
    setResult(null);
    const res = await refresh(audioSourceId, sourceName);
    if (res) {
      setResult(res);
      if (res.rescore) onRefreshed?.();
    }
  };

  const before = result?.before?.confidence ?? null;
  const after = result?.after ?? null;

  return (
    <Card className="w-full space-y-2 border-primary/20 bg-card/70 p-3 backdrop-blur">
      <div className="flex flex-wrap items-center gap-2">
        <Radar className="h-4 w-4 text-primary" />
        <h4 className="text-xs font-semibold">Audio Signal Refresh</h4>
        <Badge variant="outline" className="gap-1 px-1.5 py-0 text-[9px]">
          <ShieldCheck className="h-2.5 w-2.5" /> admin
        </Badge>
        <Button size="sm" className="ml-auto h-7 text-[11px]" disabled={busy} onClick={run}>
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
