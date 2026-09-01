import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Layers } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

type Dataset = {
  id: string;
  name: string;
  row_count: number | null;
  scored_count: number | null;
  status: string | null;
  emotional_avg: number | null;
  cognitive_avg: number | null;
  social_avg: number | null;
  communication_avg: number | null;
  contextual_avg: number | null;
  artistic_avg: number | null;
};

const CATS = [
  ["Emotional", "emotional_avg"],
  ["Cognitive", "cognitive_avg"],
  ["Social", "social_avg"],
  ["Communication", "communication_avg"],
  ["Contextual", "contextual_avg"],
  ["Artistic", "artistic_avg"],
] as const;

/**
 * Enterprise Intuizi syncs, surfaced on the homepage. Row-level security scopes
 * the read to the datasets the signed-in listener's organizations already own,
 * so the card simply hides itself when there is nothing synced.
 */
export const SyncedEnterpriseCard = () => {
  const [datasets, setDatasets] = useState<Dataset[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from("enterprise_datasets")
        .select(
          "id,name,row_count,scored_count,status,emotional_avg,cognitive_avg,social_avg,communication_avg,contextual_avg,artistic_avg",
        )
        .eq("source_kind", "intuizi")
        .order("updated_at", { ascending: false })
        .limit(4);
      if (error || cancelled) return;
      setDatasets((data ?? []) as Dataset[]);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!datasets.length) return null;

  return (
    <Card className="border-border/60 bg-card/70 p-4 backdrop-blur-sm">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Layers className="h-4 w-4 text-primary" />
        <h3 className="text-sm font-semibold">Synced enterprise analyses</h3>
        <Badge variant="secondary" className="text-[11px]">{datasets.length}</Badge>
        <Button asChild size="sm" variant="outline" className="ml-auto text-xs">
          <Link to="/workspace">Open workspace</Link>
        </Button>
      </div>

      <ul className="space-y-3">
        {datasets.map((d) => (
          <li key={d.id} className="rounded-lg border border-border/50 bg-muted/10 p-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="min-w-0 flex-1 truncate text-xs font-medium">{d.name}</span>
              <Badge variant="outline" className="text-[10px] capitalize">
                {d.status ?? "unknown"}
              </Badge>
              <span className="text-[10px] text-muted-foreground">
                {(d.scored_count ?? 0).toLocaleString()} scored ·{" "}
                {(d.row_count ?? 0).toLocaleString()} profiles
              </span>
            </div>
            <div className="mt-2 grid grid-cols-3 gap-1.5 sm:grid-cols-6">
              {CATS.map(([label, key]) => (
                <div key={key} className="rounded-md bg-background/40 px-2 py-1">
                  <p className="truncate text-[9px] uppercase tracking-wide text-muted-foreground">
                    {label}
                  </p>
                  <p className="text-xs font-semibold">
                    {d[key] == null ? "—" : Math.round(Number(d[key]))}
                  </p>
                </div>
              ))}
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
};

export default SyncedEnterpriseCard;
