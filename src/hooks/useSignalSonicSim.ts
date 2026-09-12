/**
 * Audio-driven performance scores per feed signal.
 *
 * For a granted data feed, this reads back the six SonicSIM scores averaged
 * across the devices behind each channel, genre, topic or demographic group,
 * from a bounded sample of the feed. Nothing is estimated: rows without a
 * score are excluded, and the audio-backed count says how much of each group
 * rests on real audio evidence.
 */
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { CategoryScores } from "@/lib/audioscope/types";

export interface SignalScoreFamily {
  family: string;
  values: number;
  devices: number;
}

export interface SignalScoreRow {
  value: string;
  family: string;
  devices: number;
  audio_devices: number;
  avg_confidence: number | null;
  scores: Partial<CategoryScores>;
  lead_category: string | null;
  lead_score: number | null;
}

export interface SignalSonicSimData {
  activation_id: string;
  family: string | null;
  sample_size: number;
  sampled_devices: number;
  scored_devices: number;
  families: SignalScoreFamily[];
  values: SignalScoreRow[];
  computed_at: string;
}

export const useSignalSonicSim = (
  organizationId: string,
  activationId: string,
  sample = 2000,
) => {
  const [data, setData] = useState<SignalSonicSimData | null>(null);
  const [family, setFamily] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!organizationId || !activationId) return;
    setLoading(true);
    const call = (size: number) =>
      supabase.rpc("org_signal_sonicsim", {
        _organization_id: organizationId,
        _activation_id: activationId,
        _family: family,
        _sample: size,
        _top: 12,
      });

    let { data: res, error: rpcError } = await call(sample);
    if (rpcError && /statement timeout|57014/i.test(rpcError.message)) {
      ({ data: res, error: rpcError } = await call(600));
    }
    if (rpcError) {
      setError(
        /statement timeout|57014/i.test(rpcError.message)
          ? "The database was too busy to build this sample. Try Refresh in a moment."
          : rpcError.message,
      );
      setData(null);
    } else {
      setError(null);
      const next = res as unknown as SignalSonicSimData;
      setData(next);
      // First load: settle on the family with the most scored devices.
      if (!family && next?.families?.length) setFamily(next.families[0].family);
    }
    setLoading(false);
  }, [organizationId, activationId, family, sample]);

  useEffect(() => {
    void load();
  }, [load]);

  return { data, family, setFamily, loading, error, reload: load };
};

export default useSignalSonicSim;
