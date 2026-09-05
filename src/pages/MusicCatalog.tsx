import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import {
  Disc3,
  Globe2,
  Loader2,
  Music4,
  Plus,
  Store,
  Tag,
  Trash2,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useAudioSources } from "@/hooks/useAudioSources";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { OriginalityBadge } from "@/components/OriginalityBadge";
import {
  MarketOriginalityBadge,
  MarketOriginalityPanel,
} from "@/components/catalog/MarketOriginalityPanel";
import { useMarketOriginality } from "@/hooks/useMarketOriginality";
import { formatCents, rollupCatalogOriginality } from "@/lib/catalogOriginality";
import { CreatorNav } from "@/components/creator/CreatorNav";

type Kind = "label" | "album" | "track";

interface CatalogItem {
  id: string;
  kind: Kind;
  title: string;
  artist: string | null;
  label_name: string | null;
  release_year: number | null;
  parent_id: string | null;
  audio_source_id: string | null;
  symbols: string[];
  notes: string | null;
  created_at: string;
  for_sale: boolean;
  price_cents: number | null;
  currency: string | null;
  listing_note: string | null;
}

const KIND_META: Record<Kind, { label: string; icon: typeof Music4 }> = {
  label: { label: "Label", icon: Tag },
  album: { label: "Album", icon: Disc3 },
  track: { label: "Track", icon: Music4 },
};


/**
 * Music catalog — the listener's own releases, structured the way music actually
 * is: labels hold albums, albums hold tracks. Each entry can point at an audio
 * source already in the library (so its analysis, musical read and originality
 * score attach to a real catalog row) and carry the symbols it should resolve to.
 */
const MusicCatalog = () => {
  const { user } = useAuth();
  const { mySources } = useAudioSources();
  const [items, setItems] = useState<CatalogItem[]>([]);
  const [scores, setScores] = useState<Map<string, number>>(new Map());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [view, setView] = useState<"all" | Kind>("all");
  const [priceDraft, setPriceDraft] = useState<Record<string, string>>({});
  const [listBusy, setListBusy] = useState<string | null>(null);

  const [form, setForm] = useState({
    kind: "track" as Kind,
    title: "",
    artist: "",
    label_name: "",
    release_year: "",
    parent_id: "",
    audio_source_id: "",
    symbols: "",
    notes: "",
  });

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    const { data, error } = await supabase
      .from("catalog_items")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });
    if (error) toast.error("Could not load your catalog");
    const rows = (data ?? []) as unknown as CatalogItem[];
    setItems(rows);

    // Originality comes from the analysis behind each linked audio source.
    const sourceIds = [...new Set(rows.map((r) => r.audio_source_id).filter(Boolean))] as string[];
    if (sourceIds.length) {
      const { data: analyses } = await supabase
        .from("source_analyses")
        .select("audio_source_id, originality_score, created_at")
        .in("audio_source_id", sourceIds)
        .order("created_at", { ascending: false });
      const map = new Map<string, number>();
      for (const row of (analyses ?? []) as {
        audio_source_id: string | null;
        originality_score: number | null;
      }[]) {
        if (!row.audio_source_id || map.has(row.audio_source_id)) continue;
        if (row.originality_score === null || row.originality_score === undefined) continue;
        map.set(row.audio_source_id, Number(row.originality_score));
      }
      setScores(map);
    } else {
      setScores(new Map());
    }
    setLoading(false);
  }, [user]);

  useEffect(() => {
    void load();
  }, [load]);

  const parents = useMemo(
    () =>
      items.filter((i) =>
        form.kind === "track" ? i.kind === "album" : form.kind === "album" ? i.kind === "label" : false,
      ),
    [items, form.kind],
  );

  const visible = useMemo(
    () => (view === "all" ? items : items.filter((i) => i.kind === view)),
    [items, view],
  );

  const byId = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);

  /** Track scores measured, album / label scores weighted by their symbols. */
  const { byItem: originality, bySymbol } = useMemo(
    () => rollupCatalogOriginality(items, scores),
    [items, scores],
  );

  // Real-world comparison: every linked track measured against released music.
  const linkedSourceIds = useMemo(
    () => [...new Set(items.map((i) => i.audio_source_id).filter(Boolean))] as string[],
    [items],
  );
  const { bySource: marketBySource, liveCohortSize } = useMarketOriginality(linkedSourceIds);
  const [marketOpen, setMarketOpen] = useState<string | null>(null);

  const listedCount = useMemo(() => items.filter((i) => i.for_sale).length, [items]);


  const toggleListing = async (item: CatalogItem) => {
    setListBusy(item.id);
    try {
      if (item.for_sale) {
        const { error } = await supabase
          .from("catalog_items")
          .update({ for_sale: false, listed_at: null })
          .eq("id", item.id);
        if (error) throw error;
        toast.success(`${item.title} unlisted`);
      } else {
        const raw = (priceDraft[item.id] ?? "").trim();
        const dollars = raw ? Number(raw) : NaN;
        if (!raw || !Number.isFinite(dollars) || dollars < 0 || dollars > 1_000_000) {
          toast.error("Set a price between 0 and 1,000,000 to list");
          return;
        }
        const { error } = await supabase
          .from("catalog_items")
          .update({
            for_sale: true,
            price_cents: Math.round(dollars * 100),
            currency: "USD",
            listed_at: new Date().toISOString(),
          })
          .eq("id", item.id);
        if (error) throw error;
        toast.success(`${item.title} listed on the symbol market`);
      }
      await load();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setListBusy(null);
    }
  };


  const submit = async () => {
    if (!user) return;
    const title = form.title.trim().slice(0, 200);
    if (!title) {
      toast.error("Give the entry a title");
      return;
    }
    const year = form.release_year.trim() ? Number(form.release_year.trim()) : null;
    if (year !== null && (!Number.isInteger(year) || year < 1900 || year > 2100)) {
      toast.error("Release year must be between 1900 and 2100");
      return;
    }
    setSaving(true);
    const { error } = await supabase.from("catalog_items").insert({
      user_id: user.id,
      kind: form.kind,
      title,
      artist: form.artist.trim().slice(0, 200) || null,
      label_name: form.label_name.trim().slice(0, 200) || null,
      release_year: year,
      parent_id: form.parent_id || null,
      audio_source_id: form.audio_source_id || null,
      symbols: form.symbols
        .split(",")
        .map((s) => s.trim().slice(0, 80))
        .filter(Boolean)
        .slice(0, 24),
      notes: form.notes.trim().slice(0, 1000) || null,
    });
    setSaving(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(`${KIND_META[form.kind].label} added`);
    setForm((f) => ({
      ...f,
      title: "",
      symbols: "",
      notes: "",
      audio_source_id: "",
    }));
    void load();
  };

  const remove = async (id: string) => {
    const { error } = await supabase.from("catalog_items").delete().eq("id", id);
    if (error) {
      toast.error(error.message);
      return;
    }
    setItems((prev) => prev.filter((i) => i.id !== id));
  };

  if (!user) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-16 text-center">
        <h1 className="mb-2 text-xl font-semibold">Music catalog</h1>
        <p className="text-sm text-muted-foreground">
          Sign in to build a catalog of your labels, albums and tracks.
        </p>
        <Button asChild className="mt-4">
          <Link to="/auth">Sign in</Link>
        </Button>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-5xl space-y-6 px-4 py-6 sm:py-10">
      <header className="space-y-2">
        <CreatorNav />
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-semibold tracking-tight">Music catalog</h1>
          <Button asChild size="sm" variant="outline" className="ml-auto text-xs">
            <Link to="/market">
              <Store className="mr-1 h-3.5 w-3.5" />
              Symbol market ({listedCount} listed)
            </Link>
          </Button>
        </div>

        <p className="max-w-2xl text-sm text-muted-foreground">
          Labels hold albums, albums hold tracks. Link an entry to an analyzed audio source and to
          the symbols it should resolve to, so the ontology reads your catalog the same way it reads
          any other signal.
        </p>
      </header>

      <Card className="space-y-4 border-border/60 bg-card/70 p-4 backdrop-blur-sm">
        <div className="flex items-center gap-2">
          <Plus className="h-4 w-4 text-primary" />
          <h2 className="text-sm font-semibold">Add to catalog</h2>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <div className="space-y-1.5">
            <Label className="text-xs">Type</Label>
            <Select
              value={form.kind}
              onValueChange={(v) => setForm((f) => ({ ...f, kind: v as Kind, parent_id: "" }))}
            >
              <SelectTrigger className="h-9 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="label">Label</SelectItem>
                <SelectItem value="album">Album</SelectItem>
                <SelectItem value="track">Track</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Title</Label>
            <Input
              className="h-9 text-xs"
              value={form.title}
              maxLength={200}
              onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
              placeholder={form.kind === "label" ? "Imprint name" : "Release or track name"}
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Artist</Label>
            <Input
              className="h-9 text-xs"
              value={form.artist}
              maxLength={200}
              onChange={(e) => setForm((f) => ({ ...f, artist: e.target.value }))}
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Label name</Label>
            <Input
              className="h-9 text-xs"
              value={form.label_name}
              maxLength={200}
              onChange={(e) => setForm((f) => ({ ...f, label_name: e.target.value }))}
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Release year</Label>
            <Input
              className="h-9 text-xs"
              inputMode="numeric"
              value={form.release_year}
              maxLength={4}
              onChange={(e) => setForm((f) => ({ ...f, release_year: e.target.value }))}
            />
          </div>

          {form.kind !== "label" && (
            <div className="space-y-1.5">
              <Label className="text-xs">
                {form.kind === "track" ? "Belongs to album" : "Belongs to label"}
              </Label>
              <Select
                value={form.parent_id || "none"}
                onValueChange={(v) => setForm((f) => ({ ...f, parent_id: v === "none" ? "" : v }))}
              >
                <SelectTrigger className="h-9 text-xs">
                  <SelectValue placeholder="Unassigned" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Unassigned</SelectItem>
                  {parents.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {form.kind === "track" && (
            <div className="space-y-1.5">
              <Label className="text-xs">Linked audio source</Label>
              <Select
                value={form.audio_source_id || "none"}
                onValueChange={(v) =>
                  setForm((f) => ({ ...f, audio_source_id: v === "none" ? "" : v }))
                }
              >
                <SelectTrigger className="h-9 text-xs">
                  <SelectValue placeholder="None" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None</SelectItem>
                  {(mySources ?? []).slice(0, 100).map((s: { id: string; name: string }) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="space-y-1.5 sm:col-span-2">
            <Label className="text-xs">Symbols (comma separated)</Label>
            <Input
              className="h-9 text-xs"
              value={form.symbols}
              onChange={(e) => setForm((f) => ({ ...f, symbols: e.target.value }))}
              placeholder="e.g. torchbearer, late-night, analog warmth"
            />
          </div>

          <div className="space-y-1.5 sm:col-span-2 lg:col-span-3">
            <Label className="text-xs">Notes</Label>
            <Textarea
              className="min-h-[64px] text-xs"
              value={form.notes}
              maxLength={1000}
              onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
            />
          </div>
        </div>

        <Button size="sm" onClick={submit} disabled={saving} className="text-xs">
          {saving ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : null}
          Add {KIND_META[form.kind].label.toLowerCase()}
        </Button>
      </Card>

      <div className="space-y-3">
        <Tabs value={view} onValueChange={(v) => setView(v as "all" | Kind)}>
          <TabsList className="h-8">
            <TabsTrigger value="all" className="text-xs">
              All ({items.length})
            </TabsTrigger>
            <TabsTrigger value="label" className="text-xs">
              Labels
            </TabsTrigger>
            <TabsTrigger value="album" className="text-xs">
              Albums
            </TabsTrigger>
            <TabsTrigger value="track" className="text-xs">
              Tracks
            </TabsTrigger>
          </TabsList>
        </Tabs>

        <p className="flex items-center gap-1 text-[10px] text-muted-foreground">
          <Globe2 className="h-3 w-3" />
          Market originality compares each linked track to real released music —
          {liveCohortSize >= 30
            ? ` a live cohort of ${liveCohortSize.toLocaleString()} released tracks analysed here.`
            : " the published commercial-release reference, until enough released tracks are analysed here."}
        </p>



        {loading ? (
          <Card className="flex items-center gap-2 p-6 text-xs text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading catalog…
          </Card>
        ) : visible.length === 0 ? (
          <Card className="border-dashed p-8 text-center text-xs text-muted-foreground">
            Nothing here yet — add a label, album or track above.
          </Card>
        ) : (
          <ul className="grid gap-2 sm:grid-cols-2">
            {visible.map((item) => {
              const Icon = KIND_META[item.kind].icon;
              const parent = item.parent_id ? byId.get(item.parent_id) : null;
              const roll = originality.get(item.id);
              const market = item.audio_source_id
                ? marketBySource.get(item.audio_source_id)
                : undefined;
              return (
                <li key={item.id}>
                  <Card className="flex h-full flex-col gap-2 border-border/60 bg-card/70 p-3">
                    <div className="flex items-start gap-2">
                      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{item.title}</p>
                        <p className="truncate text-[11px] text-muted-foreground">
                          {[item.artist, item.label_name, item.release_year]
                            .filter(Boolean)
                            .join(" · ") || KIND_META[item.kind].label}
                        </p>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 shrink-0"
                        onClick={() => remove(item.id)}
                        aria-label={`Remove ${item.title}`}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>

                    <div className="flex flex-wrap items-center gap-1">
                      <Badge variant="secondary" className="text-[10px]">
                        {KIND_META[item.kind].label}
                      </Badge>
                      {parent && (
                        <Badge variant="outline" className="text-[10px]">
                          in {parent.title}
                        </Badge>
                      )}
                      {item.audio_source_id && (
                        <Badge variant="outline" className="text-[10px]">
                          audio linked
                        </Badge>
                      )}
                      {roll?.score !== null && roll?.score !== undefined && (
                        <OriginalityBadge
                          score={roll.score}
                          detail={{
                            summary:
                              roll.basis === "symbols"
                                ? `Weighted across ${roll.symbols} symbol${roll.symbols === 1 ? "" : "s"} from ${roll.tracks} scored track${roll.tracks === 1 ? "" : "s"}.`
                                : "Measured from this track's own analysis.",
                          }}
                        />
                      )}
                      {market && <MarketOriginalityBadge market={market} />}
                      {item.kind !== "track" && roll?.score === null && (
                        <span className="text-[10px] text-muted-foreground">
                          no scored tracks yet
                        </span>
                      )}
                      {(item.symbols ?? []).map((sym) => {
                        const stat = bySymbol.get(sym);
                        return (
                          <Badge
                            key={sym}
                            className="bg-primary/10 text-[10px] text-primary"
                            title={
                              stat
                                ? `Originality ${stat.score} across ${stat.tracks} track(s)`
                                : "No scored tracks carry this symbol yet"
                            }
                          >
                            {sym}
                            {stat ? ` · ${stat.score}` : ""}
                          </Badge>
                        );
                      })}
                    </div>

                    {item.notes && (
                      <p className="text-[11px] text-muted-foreground">{item.notes}</p>
                    )}

                    {item.kind === "track" && (
                      <div className="mt-auto flex flex-wrap items-center gap-2 border-t border-border/50 pt-2">
                        {item.for_sale ? (
                          <>
                            <Badge className="bg-emerald-500/15 text-[10px] text-emerald-600">
                              Listed{" "}
                              {formatCents(item.price_cents, item.currency ?? "USD") ?? ""}
                            </Badge>
                            <Button
                              size="sm"
                              variant="outline"
                              className="ml-auto h-7 text-[10px]"
                              disabled={listBusy === item.id}
                              onClick={() => void toggleListing(item)}
                            >
                              {listBusy === item.id ? (
                                <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                              ) : null}
                              Unlist
                            </Button>
                          </>
                        ) : (
                          <>
                            <Input
                              value={priceDraft[item.id] ?? ""}
                              onChange={(e) =>
                                setPriceDraft((prev) => ({ ...prev, [item.id]: e.target.value }))
                              }
                              inputMode="decimal"
                              placeholder="Price USD"
                              className="h-7 w-24 text-[11px]"
                              aria-label={`Price for ${item.title}`}
                            />
                            <Button
                              size="sm"
                              className="ml-auto h-7 text-[10px]"
                              disabled={listBusy === item.id}
                              onClick={() => void toggleListing(item)}
                            >
                              {listBusy === item.id ? (
                                <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                              ) : (
                                <Store className="mr-1 h-3 w-3" />
                              )}
                              List for sale
                            </Button>
                          </>
                        )}
                      </div>
                    )}

                    {market && (
                      <div className="border-t border-border/50 pt-2">
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 px-1 text-[10px]"
                          onClick={() =>
                            setMarketOpen((prev) => (prev === item.id ? null : item.id))
                          }
                          aria-expanded={marketOpen === item.id}
                        >
                          <Globe2 className="mr-1 h-3 w-3" />
                          {marketOpen === item.id ? "Hide" : "Compare to"} the real market
                        </Button>
                      </div>
                    )}
                  </Card>

                  {market && marketOpen === item.id && (
                    <div className="mt-2">
                      <MarketOriginalityPanel title={item.title} market={market} />
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </main>
  );
};

export default MusicCatalog;
