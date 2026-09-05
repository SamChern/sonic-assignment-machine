import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { Loader2, Music4, Store, Tag } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { OriginalityBadge } from "@/components/OriginalityBadge";
import { formatCents } from "@/lib/catalogOriginality";
import { CreatorNav } from "@/components/creator/CreatorNav";

interface Listing {
  id: string;
  user_id: string;
  kind: string;
  title: string;
  artist: string | null;
  label_name: string | null;
  release_year: number | null;
  symbols: string[] | null;
  notes: string | null;
  listing_note: string | null;
  price_cents: number | null;
  currency: string | null;
  listed_at: string | null;
  audio_source_id: string | null;
}

interface AnalysisRow {
  audio_source_id: string | null;
  originality_score: number | null;
  originality_detail: unknown;
  confidence: number | null;
  emotional_score: number | null;
  cognitive_score: number | null;
  social_score: number | null;
  communication_score: number | null;
  contextual_score: number | null
  artistic_score: number | null;
}

const CATEGORIES: { key: keyof AnalysisRow; label: string }[] = [
  { key: "emotional_score", label: "Emotional" },
  { key: "cognitive_score", label: "Cognitive" },
  { key: "social_score", label: "Social" },
  { key: "communication_score", label: "Communication" },
  { key: "contextual_score", label: "Contextual" },
  { key: "artistic_score", label: "Artistic" },
];

/**
 * Symbol market — catalog tracks their owners have listed for sale, priced next
 * to the evidence a buyer actually cares about: the Originality Score, the six
 * category scores, and the symbols the track resolves to.
 */
const SymbolMarket = () => {
  const [listings, setListings] = useState<Listing[]>([]);
  const [analyses, setAnalyses] = useState<Map<string, AnalysisRow>>(new Map());
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [symbol, setSymbol] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("catalog_items")
      .select(
        "id, user_id, kind, title, artist, label_name, release_year, symbols, notes, listing_note, price_cents, currency, listed_at, audio_source_id",
      )
      .eq("for_sale", true)
      .order("listed_at", { ascending: false })
      .limit(200);

    if (error) {
      toast.error("Could not load the market");
      setLoading(false);
      return;
    }
    const rows = (data ?? []) as unknown as Listing[];
    setListings(rows);

    const sourceIds = [...new Set(rows.map((r) => r.audio_source_id).filter(Boolean))] as string[];
    if (sourceIds.length) {
      const { data: scored } = await supabase
        .from("source_analyses")
        .select(
          "audio_source_id, originality_score, originality_detail, confidence, emotional_score, cognitive_score, social_score, communication_score, contextual_score, artistic_score",
        )
        .in("audio_source_id", sourceIds)
        .order("created_at", { ascending: false });
      const map = new Map<string, AnalysisRow>();
      for (const row of (scored ?? []) as unknown as AnalysisRow[]) {
        if (row.audio_source_id && !map.has(row.audio_source_id)) map.set(row.audio_source_id, row);
      }
      setAnalyses(map);
    } else {
      setAnalyses(new Map());
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const allSymbols = useMemo(() => {
    const counts = new Map<string, number>();
    for (const l of listings) {
      for (const s of l.symbols ?? []) {
        const key = s.trim();
        if (key) counts.set(key, (counts.get(key) ?? 0) + 1);
      }
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 18);
  }, [listings]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return listings.filter((l) => {
      if (symbol && !(l.symbols ?? []).some((s) => s.trim() === symbol)) return false;
      if (!q) return true;
      return [l.title, l.artist, l.label_name, ...(l.symbols ?? [])]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q));
    });
  }, [listings, query, symbol]);

  return (
    <main className="mx-auto max-w-5xl space-y-6 px-4 py-6 sm:py-10">
      <header className="space-y-2">
        <CreatorNav />
        <div className="flex items-center gap-2">
          <Store className="h-5 w-5 text-primary" />
          <h1 className="text-2xl font-semibold tracking-tight">Symbol market</h1>
          <Badge variant="secondary" className="text-[11px]">
            {listings.length} listed
          </Badge>
        </div>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Tracks listed by their owners, priced alongside the evidence: Originality Score, the six
          SemanticAC categories, and the symbols each track resolves to.
        </p>
      </header>

      <Card className="flex flex-wrap items-center gap-2 border-border/60 bg-card/70 p-3 backdrop-blur-sm">
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search titles, artists, symbols"
          className="h-9 max-w-xs text-xs"
        />
        <div className="flex flex-wrap gap-1">
          {allSymbols.map(([sym, count]) => (
            <button
              key={sym}
              type="button"
              onClick={() => setSymbol(symbol === sym ? null : sym)}
              aria-pressed={symbol === sym}
              className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] transition-colors ${
                symbol === sym
                  ? "border-primary bg-primary/15 text-primary"
                  : "border-border/60 text-muted-foreground hover:border-primary/40"
              }`}
            >
              <Tag className="h-2.5 w-2.5" />
              {sym}
              <span className="opacity-60">{count}</span>
            </button>
          ))}
        </div>
      </Card>

      {loading ? (
        <Card className="flex items-center gap-2 p-6 text-xs text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading listings…
        </Card>
      ) : visible.length === 0 ? (
        <Card className="border-dashed p-8 text-center text-xs text-muted-foreground">
          Nothing listed yet — list a track for sale from your music catalog.
        </Card>
      ) : (
        <ul className="grid gap-2 sm:grid-cols-2">
          {visible.map((l) => {
            const analysis = l.audio_source_id ? analyses.get(l.audio_source_id) : null;
            const price = formatCents(l.price_cents, l.currency ?? "USD");
            const expanded = open === l.id;
            return (
              <li key={l.id}>
                <Card className="flex h-full flex-col gap-2 border-border/60 bg-card/70 p-3">
                  <div className="flex items-start gap-2">
                    <Music4 className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{l.title}</p>
                      <p className="truncate text-[11px] text-muted-foreground">
                        {[l.artist, l.label_name, l.release_year].filter(Boolean).join(" · ") ||
                          l.kind}
                      </p>
                    </div>
                    <span className="shrink-0 text-sm font-semibold">
                      {price ?? "Enquire"}
                    </span>
                  </div>

                  <div className="flex flex-wrap items-center gap-1">
                    <OriginalityBadge
                      score={analysis?.originality_score ?? null}
                      detail={(analysis?.originality_detail ?? null) as never}
                    />
                    {analysis?.confidence !== undefined && analysis?.confidence !== null && (
                      <Badge variant="outline" className="text-[10px]">
                        conf {Math.round(Number(analysis.confidence) * 100)}%
                      </Badge>
                    )}
                    {(l.symbols ?? []).slice(0, 4).map((sym) => (
                      <Badge key={sym} className="bg-primary/10 text-[10px] text-primary">
                        {sym}
                      </Badge>
                    ))}
                  </div>

                  {l.listing_note && (
                    <p className="text-[11px] text-muted-foreground">{l.listing_note}</p>
                  )}

                  {analysis ? (
                    <>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 self-start px-2 text-[10px]"
                        onClick={() => setOpen(expanded ? null : l.id)}
                      >
                        {expanded ? "Hide scores" : "Show category scores"}
                      </Button>
                      {expanded && (
                        <div className="space-y-1">
                          {CATEGORIES.map(({ key, label }) => {
                            const value = Number(analysis[key] ?? 0);
                            return (
                              <div key={label} className="flex items-center gap-2 text-[10px]">
                                <span className="w-24 text-muted-foreground">{label}</span>
                                <Progress value={Math.round(value)} className="h-1.5 flex-1" />
                                <span className="w-7 text-right">{Math.round(value)}</span>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </>
                  ) : (
                    <p className="text-[10px] text-muted-foreground">
                      No analysis linked — scores unavailable.
                    </p>
                  )}
                </Card>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
};

export default SymbolMarket;
