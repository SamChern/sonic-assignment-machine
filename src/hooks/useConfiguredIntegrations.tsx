import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export interface ConfiguredProvider {
  id: string;
  name: string;
  searchEndpoint: string;
}

/**
 * Returns the list of external-search providers (Apple Music, Spotify, …)
 * that an admin has configured credentials for. Used by the home-screen
 * "External Search" dropdown so we only surface providers that actually work.
 */
export const useConfiguredIntegrations = () => {
  const [providers, setProviders] = useState<ConfiguredProvider[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data, error } = await supabase.functions.invoke(
          "list-configured-integrations",
          { body: {} },
        );
        if (error) throw error;
        if (!cancelled) {
          setProviders(Array.isArray(data?.providers) ? data.providers : []);
        }
      } catch (e) {
        console.error("Failed to load configured integrations:", e);
        if (!cancelled) setProviders([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return { providers, loading };
};
