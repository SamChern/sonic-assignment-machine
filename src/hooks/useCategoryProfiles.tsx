import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  defaultCategoryProfileConfig,
  parseCategoryProfileConfig,
  type CategoryProfile,
} from "@/lib/categoryProfile";

interface Row {
  id: string;
  organization_id: string;
  version: number;
  name: string;
  notes: string | null;
  config: unknown;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

/**
 * Loads an organization's versioned semantic-category profiles. The active
 * version (or built-in defaults when none exists) is what the rest of the
 * workspace maps inputs through.
 */
export const useCategoryProfiles = (organizationId: string | null) => {
  const [versions, setVersions] = useState<CategoryProfile[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!organizationId) {
      setVersions([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const { data } = await supabase
      .from("org_category_profiles")
      .select("id, organization_id, version, name, notes, config, is_active, created_at, updated_at")
      .eq("organization_id", organizationId)
      .order("version", { ascending: false });
    setVersions(
      ((data ?? []) as Row[]).map((r) => ({
        ...r,
        config: parseCategoryProfileConfig(r.config),
      })),
    );
    setLoading(false);
  }, [organizationId]);

  useEffect(() => {
    void load();
  }, [load]);

  const activeProfile = useMemo(
    () => versions.find((v) => v.is_active) ?? versions[0] ?? null,
    [versions],
  );

  const config = useMemo(
    () => activeProfile?.config ?? defaultCategoryProfileConfig(),
    [activeProfile],
  );

  return { versions, activeProfile, config, loading, reload: load };
};
