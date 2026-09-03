import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  attributeTags,
  type CalibrationRow,
  type CategoryAttribution,
  type TagRow,
} from "@/lib/tagAttribution";

interface TagJoin {
  weight: number | null;
  taxonomy_nodes: { id: string; code: string; label: string } | null;
}

/**
 * Loads the Intuizi taxonomy tags attached to one audio source plus the learned
 * per-category behaviour of those tags, and returns the six-category
 * attribution used by the analysis dashboard.
 */
export function useTagAttribution(audioSourceId?: string, refreshKey = 0) {
  const [attribution, setAttribution] = useState<CategoryAttribution[] | null>(null);
  const [tagCount, setTagCount] = useState(0);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!audioSourceId) {
      setAttribution(null);
      setTagCount(0);
      return;
    }
    let cancelled = false;

    (async () => {
      setLoading(true);
      const { data: tagData } = await supabase
        .from("audio_source_tags")
        .select("weight, taxonomy_nodes(id, code, label)")
        .eq("audio_source_id", audioSourceId)
        .limit(200);

      const tags: TagRow[] = ((tagData ?? []) as unknown as TagJoin[])
        .filter((r) => r.taxonomy_nodes)
        .map((r) => ({
          nodeId: r.taxonomy_nodes!.id,
          code: r.taxonomy_nodes!.code,
          label: r.taxonomy_nodes!.label || r.taxonomy_nodes!.code,
          weight: Number(r.weight ?? 0),
        }));

      if (cancelled) return;
      setTagCount(tags.length);

      if (!tags.length) {
        setAttribution([]);
        setLoading(false);
        return;
      }

      const { data: calData } = await supabase
        .from("category_calibration")
        .select("taxonomy_node_id, category, mean_score, n")
        .in("taxonomy_node_id", tags.map((t) => t.nodeId));

      if (cancelled) return;

      const calibration: CalibrationRow[] = (calData ?? []).map((c) => ({
        nodeId: c.taxonomy_node_id as string,
        category: String(c.category),
        meanScore: Number(c.mean_score ?? 0),
        n: Number(c.n ?? 0),
      }));

      setAttribution(attributeTags(tags, calibration));
      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [audioSourceId, refreshKey]);

  return { attribution, tagCount, loading };
}
