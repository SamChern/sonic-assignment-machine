/**
 * Admin drill-down over one data feed's device-level signals.
 *
 * The scoring queue holds millions of rows, so the RPC works off a bounded
 * sample of the most recently touched rows for the chosen feed: pick a family
 * (CTV channel, CTV genre, web topic, demographics…), then a value inside it,
 * and get the individual devices that carry it.
 */
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export interface SignalFamily {
  family: string;
  values: number;
  devices: number;
}

export interface SignalValue {
  value: string;
  devices: number;
  share_pct: number;
}

export interface SignalDevice {
  id: string;
  identifier: string;
  report_type: string | null;
  status: string;
  labels: string[] | null;
  updated_at: string;
  grounding_level: string;
  confidence: number | null;
  scores: Record<string, number | null> | null;
}

export interface SignalExplorerData {
  activation_id: string;
  sampled_devices: number;
  sample_size: number;
  families: SignalFamily[];
  values: SignalValue[];
  devices: SignalDevice[];
  matched: number;
  computed_at: string;
}

const PAGE_SIZE = 20;

export const useSignalExplorer = (activationId: string, sample = 2000) => {
  const [data, setData] = useState<SignalExplorerData | null>(null);
  const [family, setFamily] = useState<string | null>(null);
  const [value, setValue] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!activationId) return;
    setLoading(true);
    const call = (size: number) =>
      supabase.rpc("admin_signal_explorer", {
        _activation_id: activationId,
        _family: family,
        _value: value,
        _search: search.trim() || null,
        _sample: size,
        _limit: PAGE_SIZE,
        _offset: page * PAGE_SIZE,
      });

    let { data: res, error: rpcError } = await call(sample);
    if (rpcError && /statement timeout|57014/i.test(rpcError.message)) {
      ({ data: res, error: rpcError } = await call(Math.min(sample, 500)));
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
      setData(res as unknown as SignalExplorerData);
    }
    setLoading(false);
  }, [activationId, family, value, search, page, sample]);

  useEffect(() => {
    void load();
  }, [load]);

  return {
    data,
    family,
    chooseFamily: (f: string | null) => {
      setPage(0);
      setValue(null);
      setSearch("");
      setFamily(f);
    },
    value,
    chooseValue: (v: string | null) => {
      setPage(0);
      setValue(v);
    },
    search,
    setSearch: (s: string) => {
      setPage(0);
      setSearch(s);
    },
    page,
    setPage,
    pageSize: PAGE_SIZE,
    loading,
    error,
    reload: load,
  };
};

export default useSignalExplorer;
