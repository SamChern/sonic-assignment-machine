/**
 * Grounding re-score sweep controls for the Intuizi Console.
 *
 * The sweep walks every audience that has a CLAP vector but is still scored
 * text-only and re-scores it against its audio-grounded neighbours. It is
 * bounded, resumable and leased in the database, so the console only starts,
 * pauses or nudges it — the scoring worker runs a batch on every tick.
 */
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export interface SweepRow {
  id: string;
  status: "running" | "paused" | "done" | "failed";
  batch_size: number;
  scanned: number;
  upgraded: number;
  skipped: number;
  note: string | null;
  started_at: string;
  updated_at: string;
}

export interface RescoreStatus {
  sweep: SweepRow | null;
  sources_with_vector: number;
  queue_remaining: number;
  text_only_with_vector: number;
  computed_at: string;
}

export const useGroundingRescore = () => {
  const [status, setStatus] = useState<RescoreStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error: rpcError } = await supabase.rpc("admin_grounding_rescore_status");
    if (rpcError) {
      setError(rpcError.message);
      setStatus(null);
    } else {
      setError(null);
      setStatus(data as unknown as RescoreStatus);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const control = useCallback(
    async (action: "start" | "pause" | "restart") => {
      setBusy(true);
      setNote(null);
      const { error: rpcError } = await supabase.rpc("admin_grounding_rescore_control", {
        _action: action,
        _batch: 200,
      });
      if (rpcError) setError(rpcError.message);
      else {
        setError(null);
        setNote(
          action === "pause"
            ? "Sweep paused. Nothing further will be re-scored until you resume."
            : "Sweep running. The scoring worker picks up a batch every couple of minutes.",
        );
      }
      await load();
      setBusy(false);
    },
    [load],
  );

  const runBatch = useCallback(async () => {
    setBusy(true);
    setNote(null);
    const { data, error: rpcError } = await supabase.rpc("grounding_rescore_tick", {
      _batch: 200,
    });
    if (rpcError) setError(rpcError.message);
    else {
      setError(null);
      const r = (data ?? {}) as { ran?: boolean; upgraded?: number; scanned?: number; reason?: string };
      setNote(
        r.ran
          ? `Re-scored ${r.upgraded ?? 0} of ${r.scanned ?? 0} audiences in this batch.`
          : `Nothing ran: ${r.reason ?? "no active sweep"}.`,
      );
    }
    await load();
    setBusy(false);
  }, [load]);

  return { status, loading, busy, error, note, load, control, runBatch };
};

export default useGroundingRescore;
