// Shared driver for Audio Signal Refresh (admin, open-web enrichment).
//
// One call does the whole job: the resolver agent reads open-web metadata about
// a source and attaches the resolved meaning as evidence, then the source is
// re-scored so the new evidence lifts grounding and confidence. Audio is never
// fetched or streamed — metadata only.
import { useCallback, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export interface RefreshStep {
  id: string;
  step: string;
  status: string;
  duration_ms: number | null;
}

export interface RefreshOutcome {
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
  /** Analysis confidence after the re-score, when one ran. */
  after?: number | null;
}

export function useAudioSignalRefresh() {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [phase, setPhase] = useState<string | null>(null);

  const refresh = useCallback(
    async (audioSourceId: string, sourceName?: string): Promise<RefreshOutcome | null> => {
      setBusyId(audioSourceId);
      setPhase("Reading open-web signal…");
      try {
        const { data, error } = await supabase.functions.invoke("signal-resolver", {
          body: { action: "refresh_source", audio_source_id: audioSourceId },
        });
        if (error) throw error;
        const res = data as RefreshOutcome;
        if (!res?.success) throw new Error(res?.error ?? "Audio Signal Refresh failed");

        let after: number | null = null;
        if (res.rescore) {
          setPhase("Re-scoring with the new evidence…");
          const { error: scoreErr } = await supabase.functions.invoke("analyze-audio", {
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
          });
          if (scoreErr) throw scoreErr;
          const { data: fresh } = await supabase
            .from("source_analyses")
            .select("confidence")
            .eq("audio_source_id", audioSourceId)
            .order("created_at", { ascending: false })
            .limit(1);
          after = Number(fresh?.[0]?.confidence ?? 0);
          const prev = res.before?.confidence ?? 0;
          toast.success(
            `Signal refreshed — confidence ${(prev * 100).toFixed(0)}% → ${(after * 100).toFixed(0)}%`,
          );
        } else {
          toast.info(
            `Open-web signal too weak to use (${((res.confidence ?? 0) * 100).toFixed(0)}%) — analysis left unchanged.`,
          );
        }
        return { ...res, after };
      } catch (e) {
        toast.error((e as Error).message);
        return null;
      } finally {
        setBusyId(null);
        setPhase(null);
      }
    },
    [],
  );

  return { refresh, busyId, phase, busy: busyId !== null };
}
