import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import SavedAnalysisDrawer, { type DrawerAnalysis } from "@/components/SavedAnalysisDrawer";
import { CATEGORY_KEYS } from "@/lib/enterpriseSchema";
import { WaveformBackground } from "@/components/WaveformBackground";
import {
  ChevronDown,
  ChevronRight,
  Loader2,
  Maximize2,
  RefreshCw,
  Search,
  Sparkles,
} from "lucide-react";

const PAGE = 25;

/** Short labels + gradients mirroring the admin analysis results bar chart. */
const CATEGORY_META: Array<{ key: (typeof CATEGORY_KEYS)[number]; short: string; gradient: string }> = [
  { key: "emotional", short: "Emo", gradient: "var(--gradient-emotional)" },
  { key: "cognitive", short: "Cog", gradient: "var(--gradient-cognitive)" },
  { key: "social", short: "Soc", gradient: "var(--gradient-social)" },
  { key: "communication", short: "Com", gradient: "var(--gradient-communication)" },
  { key: "contextual", short: "Ctx", gradient: "var(--gradient-contextual)" },
  { key: "artistic", short: "Art", gradient: "var(--gradient-artistic)" },
];

type SortKey = "newest" | "oldest" | "confidence_desc" | "source_asc";

interface Row extends DrawerAnalysis {
  organization_id: string | null;
}

const relative = (iso: string) => {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.round(diff / 60000);
  if (mins < 60) return `${Math.max(1, mins)}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
};

/** Labelled score bars: "Emo ▓▓▓ 40" in a responsive 1/2/3 column grid. */
const ScoreBars = ({ row }: { row: Row }) => (
  <div className="grid grid-cols-1 gap-x-6 gap-y-1.5 sm:grid-cols-2 lg:grid-cols-3">
    {CATEGORY_META.map(({ key, short, gradient }) => {
      const score = Math.round(Number((row as unknown as Record<string, number>)[`${key}_score`] ?? 0));
      return (
        <div key={key} className="flex items-center gap-2">
          <span className="w-8 shrink-0 text-[10px] uppercase tracking-wide text-muted-foreground">
            {short}
          </span>
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full"
              style={{ width: `${Math.max(2, Math.min(100, score))}%`, background: gradient }}
            />
          </div>
          <span className="w-7 shrink-0 text-right text-[11px] tabular-nums text-muted-foreground">
            {score}
          </span>
        </div>
      );
    })}
  </div>
);


/** Org-scoped mirror of the admin analysis results list. */
const WorkspaceAnalyses = ({ organizationId }: { organizationId: string }) => {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [more, setMore] = useState(false);
  const [count, setCount] = useState(0);
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [sort, setSort] = useState<SortKey>("newest");
  const [selected, setSelected] = useState<DrawerAnalysis | null>(null);
  /** Sources/analyses list starts collapsed; the latest analysis is always shown. */
  const [expanded, setExpanded] = useState(false);


  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), 300);
    return () => clearTimeout(t);
  }, [query]);

  const load = useCallback(
    async (offset = 0) => {
      offset === 0 ? setLoading(true) : setMore(true);
      let q = supabase
        .from("source_analyses")
        .select(
          "id, source_name, audio_source_id, category, confidence, created_at, emotional_score, cognitive_score, social_score, communication_score, contextual_score, artistic_score, organization_id",
          { count: "exact" },
        )
        .eq("organization_id", organizationId);

      if (debounced) q = q.ilike("source_name", `%${debounced}%`);

      if (sort === "newest") q = q.order("created_at", { ascending: false });
      else if (sort === "oldest") q = q.order("created_at", { ascending: true });
      else if (sort === "confidence_desc") q = q.order("confidence", { ascending: false });
      else q = q.order("source_name", { ascending: true });

      const { data, error, count: total } = await q.range(offset, offset + PAGE - 1);
      if (!error) {
        setRows((prev) => (offset === 0 ? (data ?? []) as Row[] : [...prev, ...((data ?? []) as Row[])]));
        setCount(total ?? 0);
      }
      setLoading(false);
      setMore(false);
    },
    [organizationId, debounced, sort],
  );

  useEffect(() => {
    void load(0);
  }, [load]);

  const summary = useMemo(() => {
    if (!rows.length) return null;
    const avg = (k: string) =>
      rows.reduce((s, r) => s + Number((r as unknown as Record<string, number>)[k] ?? 0), 0) / rows.length;
    return CATEGORY_KEYS.map((c) => ({ key: c, value: avg(`${c}_score`) }));
  }, [rows]);

  const latest = rows[0] ?? null;


  return (
    <div className="space-y-4">
      <Card className="p-4">
        <div className="flex flex-wrap items-center gap-2">
          <Sparkles className="h-4 w-4 text-primary" />
          <h2 className="text-sm font-semibold">Recent analyses</h2>
          <Badge variant="outline" className="text-[11px]">{count} total</Badge>
          <Button
            variant="ghost"
            size="sm"
            className="ml-auto"
            onClick={() => void load(0)}
            disabled={loading}
          >
            <RefreshCw className={`mr-1 h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>

        {summary && (
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
            {summary.map((s) => (
              <div key={s.key} className="rounded-lg border border-border/60 bg-muted/20 p-2">
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{s.key}</p>
                <p className="text-lg font-semibold">{s.value.toFixed(0)}</p>
              </div>
            ))}
          </div>
        )}

        <div className="mt-4 flex flex-wrap gap-2">
          <div className="relative min-w-[200px] flex-1">
            <Search className="absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by source name"
              className="pl-8"
            />
          </div>
          <Select value={sort} onValueChange={(v) => setSort(v as SortKey)}>
            <SelectTrigger className="w-full sm:w-[190px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="newest">Newest first</SelectItem>
              <SelectItem value="oldest">Oldest first</SelectItem>
              <SelectItem value="confidence_desc">Highest confidence</SelectItem>
              <SelectItem value="source_asc">Source A–Z</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Latest saved analysis, with the labelled category bar chart. */}
        {latest && (
          <div className="mt-4 border-t border-border/60 pt-3">
            <div className="flex flex-wrap items-center gap-2">
              <p className="min-w-0 break-words text-sm font-medium">{latest.source_name}</p>
              {latest.category && (
                <Badge variant="secondary" className="text-[11px]">{latest.category}</Badge>
              )}
              <span className="text-[11px] text-muted-foreground">
                confidence {(Number(latest.confidence ?? 0) * 100).toFixed(0)}% · {relative(latest.created_at)}
              </span>
            </div>
            <div className="mt-2">
              <ScoreBars row={latest} />
            </div>
            <Button variant="outline" size="sm" className="mt-3" onClick={() => setSelected(latest)}>
              <Maximize2 className="mr-1 h-3.5 w-3.5" />
              View full details
            </Button>
          </div>
        )}
      </Card>

      {loading ? (
        <div className="space-y-2">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </div>
      ) : !rows.length ? (
        <Card className="p-6 text-center">
          <p className="text-sm font-medium">No analyses in this workspace yet</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Upload a dataset below, or analyze audio sources — results attached to this organization
            appear here.
          </p>
        </Card>
      ) : (
        <div className="space-y-2">
          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-start"
            onClick={() => setExpanded((v) => !v)}
            aria-expanded={expanded}
          >
            {expanded ? (
              <ChevronDown className="mr-1 h-4 w-4" />
            ) : (
              <ChevronRight className="mr-1 h-4 w-4" />
            )}
            {expanded ? "Hide" : "Show"} all sources &amp; analyses ({count})
          </Button>

          {expanded && (
            <div className="relative isolate overflow-hidden rounded-lg">
              {/* Very transparent waveform texture behind the source rows. */}
              <div className="pointer-events-none absolute inset-0 -z-10 opacity-[0.07]">
                <WaveformBackground />
              </div>

              <div className="space-y-2 p-1">
                {rows.map((r) => (
                  <Card key={r.id} className="bg-card/70 p-3 backdrop-blur-sm">
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="break-words text-sm font-medium sm:truncate">{r.source_name}</p>
                        <p className="mt-0.5 flex flex-wrap gap-x-2 text-[11px] text-muted-foreground">
                          <span>{relative(r.created_at)}</span>
                          {r.category && <span className="text-primary">{r.category}</span>}
                          <span>confidence {(Number(r.confidence ?? 0) * 100).toFixed(0)}%</span>
                        </p>
                      </div>
                      <Button variant="outline" size="sm" onClick={() => setSelected(r)}>
                        <Maximize2 className="mr-1 h-3.5 w-3.5" />
                        Details
                      </Button>
                    </div>
                    <div className="mt-2">
                      <ScoreBars row={r} />
                    </div>
                  </Card>
                ))}

                {rows.length < count && (
                  <Button
                    variant="outline"
                    className="w-full"
                    onClick={() => void load(rows.length)}
                    disabled={more}
                  >
                    {more && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
                    Load more
                  </Button>
                )}
              </div>
            </div>
          )}
        </div>
      )}


      <SavedAnalysisDrawer
        analysis={selected}
        open={!!selected}
        onOpenChange={(open) => !open && setSelected(null)}
      />
    </div>
  );
};

export default WorkspaceAnalyses;
