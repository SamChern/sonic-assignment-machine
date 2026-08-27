import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export interface InferenceCheck {
  id: string;
  label: string;
  state: "ok" | "warn" | "fail";
  detail: string;
}

export interface InferenceReadiness {
  verdict: "ok" | "warn" | "blocked";
  blocked: boolean;
  ec2_required: boolean;
  gpu: boolean | null;
  chat_provider: "ec2" | "gateway" | "none";
  selected_chat_model: string | null;
  selected_embedding_model: string | null;
  served_models: string[];
  checks: InferenceCheck[];
  summary: string;
}

/**
 * Validates that EC2 GPU inference is correctly configured for the selected
 * model before any "run semantic analysis" action is allowed. While the check
 * is in flight, actions stay disabled (fail-closed).
 */
export function useInferenceReadiness() {
  const [data, setData] = useState<InferenceReadiness | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const check = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data: res, error: err } = await supabase.functions.invoke(
      "inference-config-validate",
      { body: {} },
    );
    setLoading(false);
    if (err || !res?.success) {
      setError(err?.message ?? res?.error ?? "Could not validate inference configuration");
      setData(null);
      return;
    }
    setData(res as InferenceReadiness);
  }, []);

  useEffect(() => {
    void check();
  }, [check]);

  // Fail closed: block while unknown or on validator error.
  const blocked = loading || !!error || (data?.blocked ?? true);

  return { readiness: data, loading, error, blocked, recheck: check };
}
