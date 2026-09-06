import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Skeleton } from "@/components/ui/skeleton";
import SonicSimPanel, { type SonicSimSubject } from "@/components/visuals/SonicSimPanel";
import { AUDIOSCOPE_CATEGORIES, analysisToScores, emptyScores } from "@/lib/audioscope";

interface Row {
  id: string;
  source_name: string;
  created_at: string;
  emotional_score: number;
  cognitive_score: number;
  social_score: number;
  communication_score: number;
  contextual_score: number;
  artistic_score: number;
}

const SELECT =
  "id, source_name, created_at, emotional_score, cognitive_score, social_score, communication_score, contextual_score, artistic_score";

/**
 * Admin audioscope: every visualization mode including the three-lens Semantic
 * Scope, with the admin lens (kNN / prior debug readout).
 */
export const AdminSonicSim = () => {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const { data } = await supabase
        .from("source_analyses")
        .select(SELECT)
        .order("created_at", { ascending: false })
        .limit(60);
      if (!cancelled) {
        setRows((data ?? []) as Row[]);
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const subjects = useMemo<SonicSimSubject[]>(() => {
    if (rows.length === 0) return [];
    const agg = emptyScores();
    for (const c of AUDIOSCOPE_CATEGORIES) {
      agg[c] =
        rows.reduce(
          (s, r) => s + (Number((r as unknown as Record<string, number>)[`${c}_score`]) || 0),
          0,
        ) / rows.length;
    }
    return [
      {
        id: "platform-aggregate",
        label: "Platform aggregate",
        sublabel: `Aggregate · ${rows.length} most recent analyses`,
        scores: agg,
      },
      ...rows.map((r) => ({
        id: r.id,
        label: r.source_name,
        sublabel: `Analysis · ${r.source_name}`,
        scores: analysisToScores(r as unknown as Record<string, unknown>),
      })),
    ];
  }, [rows]);

  if (loading) return <Skeleton className="h-72 w-full rounded-xl" />;

  return (
    <SonicSimPanel
      lens="admin"
      defaultMode="semantic"
      modes={["semantic", "scope", "radial", "nodes"]}
      subjects={subjects}
      title="SonicSIM audioscope"
      description="Play the platform aggregate or any single analysis, including the three-lens Semantic Scope."
    />
  );
};

export default AdminSonicSim;
