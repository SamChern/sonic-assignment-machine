// Side-by-side compare for two saved analyses in My Library.
//
// Pick two rows and the six SemanticAC categories line up as paired bars with a
// per-category delta, so a listener can see exactly where the two sources pull
// their meaning from differently.
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Columns2, Loader2, X } from "lucide-react";

const CATEGORIES = [
  { key: "emotional_score", name: "Emotional", tone: "bg-[hsl(var(--category-emotional))]" },
  { key: "cognitive_score", name: "Cognitive", tone: "bg-[hsl(var(--category-cognitive))]" },
  { key: "social_score", name: "Social", tone: "bg-[hsl(var(--category-social))]" },
  { key: "communication_score", name: "Communication", tone: "bg-[hsl(var(--category-communication))]" },
  { key: "contextual_score", name: "Contextual", tone: "bg-[hsl(var(--category-contextual))]" },
  { key: "artistic_score", name: "Artistic", tone: "bg-[hsl(var(--category-artistic))]" },
] as const;

interface CompareRow {
  id: string;
  source_name: string;
  confidence: number | null;
  grounding_level: string | null;
  category: string | null;
  emotional_score: number | null;
  cognitive_score: number | null;
  social_score: number | null;
  communication_score: number | null;
  contextual_score: number | null;
  artistic_score: number | null;
}

const SELECT =
  "id, source_name, confidence, grounding_level, category, emotional_score, cognitive_score, social_score, communication_score, contextual_score, artistic_score";

export const AnalysisCompare = ({
  ids,
  onClear,
}: {
  ids: [string, string];
  onClear: () => void;
}) => {
  const [rows, setRows] = useState<CompareRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      const { data } = await supabase
        .from("source_analyses")
        .select(SELECT)
        .in("id", ids);
      if (!alive) return;
      // Preserve the order the listener picked them in.
      const byId = new Map(((data ?? []) as CompareRow[]).map((r) => [r.id, r]));
      setRows(ids.map((id) => byId.get(id)).filter(Boolean) as CompareRow[]);
      setLoading(false);
    })();
    return () => {
      alive = false;
    };
  }, [ids]);

  if (loading) {
    return (
      <Card className="flex items-center justify-center border-primary/20 bg-card/70 p-6">
        <Loader2 className="h-4 w-4 animate-spin text-primary" />
      </Card>
    );
  }

  if (rows.length < 2) {
    return (
      <Card className="border-primary/20 bg-card/70 p-4 text-xs text-muted-foreground">
        Couldn't load both analyses to compare.
      </Card>
    );
  }

  const [a, b] = rows;

  return (
    <Card className="space-y-3 border-primary/30 bg-card/70 p-4 backdrop-blur-sm">
      <div className="flex flex-wrap items-center gap-2">
        <Columns2 className="h-4 w-4 text-primary" />
        <h4 className="text-sm font-semibold">Side by side</h4>
        <Button
          size="sm"
          variant="ghost"
          className="ml-auto h-7 px-2 text-[11px]"
          onClick={onClear}
        >
          <X className="mr-1 h-3 w-3" /> Clear
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-3 text-xs">
        {[a, b].map((r, i) => (
          <div key={r.id} className="min-w-0 space-y-1">
            <p className="truncate font-medium">{r.source_name}</p>
            <div className="flex flex-wrap gap-1">
              {r.category && (
                <Badge variant="secondary" className="px-1.5 py-0 text-[9px]">
                  {r.category}
                </Badge>
              )}
              <Badge variant="outline" className="px-1.5 py-0 text-[9px]">
                {r.grounding_level ?? "ungrounded"}
              </Badge>
              <Badge variant="outline" className="px-1.5 py-0 text-[9px]">
                conf {((Number(r.confidence ?? 0)) * 100).toFixed(0)}%
              </Badge>
            </div>
            <p className="text-[10px] text-muted-foreground">
              {i === 0 ? "left" : "right"}
            </p>
          </div>
        ))}
      </div>

      <div className="space-y-2">
        {CATEGORIES.map((c) => {
          const av = Number(a[c.key] ?? 0);
          const bv = Number(b[c.key] ?? 0);
          const diff = av - bv;
          return (
            <div key={c.key} className="space-y-1">
              <div className="flex items-center justify-between text-[10px]">
                <span className="font-medium">{c.name}</span>
                <span
                  className={`tabular-nums ${
                    Math.abs(diff) < 3 ? "text-muted-foreground" : "text-primary"
                  }`}
                >
                  {av.toFixed(0)} vs {bv.toFixed(0)}
                  {Math.abs(diff) >= 3 && ` · ${diff > 0 ? "+" : ""}${diff.toFixed(0)}`}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-1">
                {/* left bar grows right-to-left so the pair reads as a mirror */}
                <div className="flex h-2 justify-end overflow-hidden rounded-full bg-muted/30">
                  <div className={`h-full ${c.tone}`} style={{ width: `${Math.max(0, Math.min(100, av))}%` }} />
                </div>
                <div className="flex h-2 overflow-hidden rounded-full bg-muted/30">
                  <div className={`h-full ${c.tone}`} style={{ width: `${Math.max(0, Math.min(100, bv))}%` }} />
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
};

export default AnalysisCompare;
