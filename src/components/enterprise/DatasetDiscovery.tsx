import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { CATEGORY_KEYS } from "@/lib/enterpriseSchema";
import { Compass, RefreshCw } from "lucide-react";

export interface DatasetRow {
  id: string;
  name: string;
  description: string | null;
  row_count: number;
  scored_count: number;
  status: string;
  created_at: string;
  emotional_avg: number | null;
  cognitive_avg: number | null;
  social_avg: number | null;
  communication_avg: number | null;
  contextual_avg: number | null;
  artistic_avg: number | null;
}

const vector = (d: DatasetRow) =>
  CATEGORY_KEYS.map((c) => Number((d as unknown as Record<string, number | null>)[`${c}_avg`] ?? 0));

/** Cosine-style closeness on the 6-category profile, expressed 0-100. */
const similarity = (a: number[], b: number[]) => {
  const dot = a.reduce((s, v, i) => s + v * b[i], 0);
  const na = Math.sqrt(a.reduce((s, v) => s + v * v, 0));
  const nb = Math.sqrt(b.reduce((s, v) => s + v * v, 0));
  if (!na || !nb) return 0;
  const cos = dot / (na * nb);
  const dist =
    Math.sqrt(a.reduce((s, v, i) => s + (v - b[i]) ** 2, 0)) / (100 * Math.sqrt(a.length));
  return Math.max(0, Math.min(100, (cos * 0.6 + (1 - dist) * 0.4) * 100));
};

/**
 * Dataset-to-dataset discovery — the enterprise counterpart to taste neighbors,
 * comparing semantic profiles between datasets instead of between people.
 */
const DatasetDiscovery = ({ organizationId }: { organizationId: string }) => {
  const [datasets, setDatasets] = useState<DatasetRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [anchor, setAnchor] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("enterprise_datasets")
      .select(
        "id, name, description, row_count, scored_count, status, created_at, emotional_avg, cognitive_avg, social_avg, communication_avg, contextual_avg, artistic_avg",
      )
      .eq("organization_id", organizationId)
      .order("created_at", { ascending: false })
      .limit(100);
    if (!error) {
      const rows = (data ?? []) as DatasetRow[];
      setDatasets(rows);
      setAnchor((prev) => prev ?? rows.find((r) => r.scored_count > 0)?.id ?? rows[0]?.id ?? null);
    }
    setLoading(false);
  }, [organizationId]);

  useEffect(() => {
    void load();
  }, [load]);

  const neighbors = useMemo(() => {
    const base = datasets.find((d) => d.id === anchor);
    if (!base) return [];
    const bv = vector(base);
    return datasets
      .filter((d) => d.id !== base.id && d.scored_count > 0)
      .map((d) => ({ dataset: d, score: similarity(bv, vector(d)) }))
      .sort((a, b) => b.score - a.score);
  }, [datasets, anchor]);

  if (loading) {
    return (
      <div className="space-y-2">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-20 w-full" />
        ))}
      </div>
    );
  }

  if (!datasets.length) {
    return (
      <Card className="p-6 text-center">
        <p className="text-sm font-medium">No datasets yet</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Upload a CSV to compare its semantic profile against your other datasets.
        </p>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <div className="flex flex-wrap items-center gap-2">
          <Compass className="h-4 w-4 text-primary" />
          <h2 className="text-sm font-semibold">Discover related datasets</h2>
          <Button variant="ghost" size="sm" className="ml-auto" onClick={() => void load()}>
            <RefreshCw className="mr-1 h-4 w-4" />
            Refresh
          </Button>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {datasets.map((d) => (
            <button
              key={d.id}
              onClick={() => setAnchor(d.id)}
              className={`rounded-full border px-3 py-1 text-xs transition ${
                anchor === d.id
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border text-muted-foreground hover:border-primary/50"
              }`}
            >
              {d.name} · {d.scored_count}/{d.row_count}
            </button>
          ))}
        </div>
      </Card>

      {!neighbors.length ? (
        <Card className="p-6 text-center text-xs text-muted-foreground">
          Add at least one more scored dataset to see semantic neighbours.
        </Card>
      ) : (
        <div className="space-y-2">
          {neighbors.map(({ dataset, score }) => (
            <Card key={dataset.id} className="p-3">
              <div className="flex flex-wrap items-center gap-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{dataset.name}</p>
                  {dataset.description && (
                    <p className="truncate text-[11px] text-muted-foreground">{dataset.description}</p>
                  )}
                </div>
                <Badge variant="outline" className="text-[11px]">
                  {score.toFixed(0)}% similar
                </Badge>
              </div>
              <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-6">
                {CATEGORY_KEYS.map((c) => (
                  <div key={c}>
                    <p className="text-[10px] uppercase text-muted-foreground">{c.slice(0, 5)}</p>
                    <p className="text-sm font-semibold">
                      {Number(
                        (dataset as unknown as Record<string, number | null>)[`${c}_avg`] ?? 0,
                      ).toFixed(0)}
                    </p>
                  </div>
                ))}
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
};

export default DatasetDiscovery;
