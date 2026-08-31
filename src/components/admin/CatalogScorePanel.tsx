import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Award, Loader2, RefreshCw, Search, Tag } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import {
  rankLabelCatalogs,
  WEIGHTS,
  type CatalogAnalysisFacts,
  type CatalogScoreItem,
  type LabelScore,
} from "@/lib/catalogScore";

type SortKey = "score" | "originality" | "grounding" | "completeness";

const SORTS: { key: SortKey; label: string }[] = [
  { key: "score", label: "Catalog score" },
  { key: "originality", label: "Originality" },
  { key: "grounding", label: "Grounding" },
  { key: "completeness", label: "Completeness" },
];

const tone = (score: number | null) => {
  if (score === null) return "text-muted-foreground";
  if (score >= 75) return "text-emerald-500";
  if (score >= 50) return "text-primary";
  if (score >= 30) return "text-amber-500";
  return "text-destructive";
};

/**
 * Admin catalog score board — ranks every label by originality, grounding
 * confidence and catalog completeness so we can see which catalogs are
 * quotable and which need signal work.
 */
export const CatalogScorePanel = () => {
  const [rows, setRows] = useState<LabelScore[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortKey>("score");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data: items, error } = await supabase
        .from("catalog_items")
        .select(
          "id, kind, title, parent_id, audio_source_id, symbols, artist, label_name, release_year, for_sale",
        )
        .limit(2000);
      if (error) throw error;

      const catalog = (items ?? []) as unknown as CatalogScoreItem[];
      const sourceIds = [
        ...new Set(catalog.map((i) => i.audio_source_id).filter(Boolean)),
      ] as string[];

      const facts = new Map<string, CatalogAnalysisFacts>();
      if (sourceIds.length) {
        const { data: analyses, error: aErr } = await supabase
          .from("source_analyses")
          .select("audio_source_id, originality_score, confidence, grounding_level, created_at")
          .in("audio_source_id", sourceIds)
          .order("created_at", { ascending: false })
          .limit(4000);
        if (aErr) throw aErr;
        for (const row of (analyses ?? []) as {
          audio_source_id: string | null;
          originality_score: number | null;
          confidence: number | null;
          grounding_level: string | null;
        }[]) {
          if (!row.audio_source_id || facts.has(row.audio_source_id)) continue;
          facts.set(row.audio_source_id, {
            originality_score: row.originality_score,
            confidence: row.confidence,
            grounding_level: row.grounding_level,
          });
        }
      }

      setRows(rankLabelCatalogs(catalog, facts));
    } catch (e) {
      toast.error(`Could not score catalogs: ${(e as Error).message}`);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = q ? rows.filter((r) => r.title.toLowerCase().includes(q)) : rows;
    if (sort === "score") return filtered;
    return [...filtered].sort((a, b) => {
      const av = (a[sort] as number | null) ?? -1;
      const bv = (b[sort] as number | null) ?? -1;
      return bv - av || a.title.localeCompare(b.title);
    });
  }, [rows, query, sort]);

  return (
    <Card className="border-border/60 bg-card/70 p-4">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Award className="h-4 w-4 text-primary" />
        <h2 className="text-sm font-semibold">Catalog scores</h2>
        <Badge variant="secondary" className="text-[10px]">
          {Math.round(WEIGHTS.originality * 100)}% originality ·{" "}
          {Math.round(WEIGHTS.grounding * 100)}% grounding ·{" "}
          {Math.round(WEIGHTS.completeness * 100)}% completeness
        </Badge>
        <Button
          size="sm"
          variant="outline"
          className="ml-auto h-7 text-[11px]"
          onClick={() => void load()}
          disabled={loading}
        >
          {loading ? (
            <Loader2 className="mr-1 h-3 w-3 animate-spin" />
          ) : (
            <RefreshCw className="mr-1 h-3 w-3" />
          )}
          Recompute
        </Button>
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative min-w-[180px] flex-1">
          <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search labels"
            className="h-8 pl-7 text-xs"
            aria-label="Search labels"
          />
        </div>
        <div className="flex flex-wrap gap-1">
          {SORTS.map((s) => (
            <Button
              key={s.key}
              size="sm"
              variant={sort === s.key ? "default" : "outline"}
              className="h-7 text-[10px]"
              onClick={() => setSort(s.key)}
            >
              {s.label}
            </Button>
          ))}
        </div>
      </div>

      {loading ? (
        <p className="py-6 text-center text-xs text-muted-foreground">Scoring catalogs…</p>
      ) : visible.length === 0 ? (
        <p className="py-6 text-center text-xs text-muted-foreground">
          No labels in the catalog yet — add a label in the music catalog to see it ranked here.
        </p>
      ) : (
        <ul className="space-y-2">
          {visible.map((row, index) => (
            <li key={row.id}>
              <div className="rounded-lg border border-border/50 bg-background/40 p-3">
                <div className="flex items-start gap-2">
                  <span className="mt-0.5 w-5 shrink-0 text-[11px] font-semibold text-muted-foreground">
                    {index + 1}
                  </span>
                  <Tag className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{row.title}</p>
                    <p className="text-[11px] text-muted-foreground">
                      {row.albums} album{row.albums === 1 ? "" : "s"} · {row.tracks} track
                      {row.tracks === 1 ? "" : "s"} · {row.scoredTracks} scored ·{" "}
                      {row.groundedTracks} grounded · {row.symbols} symbol
                      {row.symbols === 1 ? "" : "s"}
                      {row.listedTracks > 0 ? ` · ${row.listedTracks} listed` : ""}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className={`text-lg font-semibold leading-none ${tone(row.score)}`}>
                      {row.score}
                    </p>
                    <p className="text-[10px] text-muted-foreground">catalog score</p>
                  </div>
                </div>

                <div className="mt-3 grid gap-2 sm:grid-cols-3">
                  {[
                    { label: "Originality", value: row.originality },
                    { label: "Grounding", value: row.grounding },
                    { label: "Completeness", value: row.completeness },
                  ].map((leg) => (
                    <div key={leg.label}>
                      <div className="mb-1 flex items-center justify-between text-[10px]">
                        <span className="text-muted-foreground">{leg.label}</span>
                        <span className={tone(leg.value)}>
                          {leg.value === null ? "—" : leg.value}
                        </span>
                      </div>
                      <Progress value={leg.value ?? 0} className="h-1.5" />
                    </div>
                  ))}
                </div>

                <p className="mt-2 text-[10px] text-muted-foreground">
                  Weakest leg: {row.gap}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
};

export default CatalogScorePanel;
