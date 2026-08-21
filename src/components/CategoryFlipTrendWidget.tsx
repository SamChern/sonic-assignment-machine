import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/hooks/use-toast";
import { Loader2, RefreshCw, Repeat2 } from "lucide-react";

const CATEGORIES = [
  "emotional",
  "cognitive",
  "social",
  "communication",
  "contextual",
  "artistic",
] as const;
type Category = (typeof CATEGORIES)[number];

const SCOPES = [
  { key: "intuizi", label: "Intuizi" },
  { key: "ctv", label: "CTV" },
  { key: "global", label: "Global" },
] as const;
type ScopeKey = (typeof SCOPES)[number]["key"];

const scopeOf = (sourceType?: string | null): ScopeKey => {
  if (sourceType === "intuizi") return "intuizi";
  if (sourceType === "ctv") return "ctv";
  return "global";
};

const dominant = (m: Record<string, number>): Category =>
  CATEGORIES.reduce((a, b) => ((m[b] ?? 0) > (m[a] ?? 0) ? b : a), CATEGORIES[0]);

type Grain = "day" | "week";

interface Analysis {
  at: Date;
  scope: ScopeKey;
  before: Category | null;
  after: Category;
}

interface Bucket {
  label: string;
  start: Date;
  total: number;
  measured: number;
  flips: number;
}

const bucketStart = (d: Date, grain: Grain) => {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  if (grain === "week") x.setDate(x.getDate() - x.getDay());
  return x;
};

const fmt = (d: Date, grain: Grain) =>
  grain === "week"
    ? `w/${d.toLocaleDateString(undefined, { month: "numeric", day: "numeric" })}`
    : d.toLocaleDateString(undefined, { month: "numeric", day: "numeric" });

const buildBuckets = (rows: Analysis[], grain: Grain, periods: number): Bucket[] => {
  const now = bucketStart(new Date(), grain);
  const out: Bucket[] = [];
  for (let i = periods - 1; i >= 0; i--) {
    const start = new Date(now);
    if (grain === "week") start.setDate(start.getDate() - i * 7);
    else start.setDate(start.getDate() - i);
    out.push({ label: fmt(start, grain), start, total: 0, measured: 0, flips: 0 });
  }
  for (const r of rows) {
    const s = bucketStart(r.at, grain).getTime();
    const b = out.find((x) => x.start.getTime() === s);
    if (!b) continue;
    b.total += 1;
    if (r.before) {
      b.measured += 1;
      if (r.before !== r.after) b.flips += 1;
    }
  }
  return out;
};

const CategoryFlipTrendWidget = () => {
  const [rows, setRows] = useState<Analysis[]>([]);
  const [loading, setLoading] = useState(true);
  const [grain, setGrain] = useState<Grain>("week");

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("source_analyses")
      .select(
        "created_at,raw_scores,emotional_score,cognitive_score,social_score,communication_score,contextual_score,artistic_score,audio_sources(source_type)",
      )
      .order("created_at", { ascending: false })
      .limit(1000);
    setLoading(false);
    if (error) {
      toast({ title: "Could not load flip trend", description: error.message, variant: "destructive" });
      return;
    }
    const mapped: Analysis[] = (data ?? []).map((r: any) => {
      const after = {} as Record<string, number>;
      for (const c of CATEGORIES) after[c] = Number(r[`${c}_score`] ?? 0);
      const rawObj = r.raw_scores as Record<string, number> | null;
      const hasRaw = !!rawObj && CATEGORIES.some((c) => typeof rawObj[c] === "number");
      const before = {} as Record<string, number>;
      if (hasRaw) for (const c of CATEGORIES) before[c] = Number(rawObj?.[c] ?? 0);
      return {
        at: new Date(r.created_at),
        scope: scopeOf(r.audio_sources?.source_type),
        before: hasRaw ? dominant(before) : null,
        after: dominant(after),
      };
    });
    setRows(mapped);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const periods = grain === "week" ? 8 : 14;

  const perScope = useMemo(
    () =>
      SCOPES.map((s) => {
        const scoped = rows.filter((r) => r.scope === s.key);
        const buckets = buildBuckets(scoped, grain, periods);
        const measured = scoped.filter((r) => r.before).length;
        const flips = scoped.filter((r) => r.before && r.before !== r.after).length;
        const shifts = new Map<string, number>();
        for (const r of scoped) {
          if (r.before && r.before !== r.after) {
            const k = `${r.before} → ${r.after}`;
            shifts.set(k, (shifts.get(k) ?? 0) + 1);
          }
        }
        const topShifts = [...shifts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
        return {
          ...s,
          buckets,
          total: scoped.length,
          measured,
          flips,
          rate: measured > 0 ? flips / measured : 0,
          topShifts,
        };
      }),
    [rows, grain, periods],
  );

  const maxBucket = Math.max(
    1,
    ...perScope.flatMap((s) => s.buckets.map((b) => Math.max(b.measured, b.total))),
  );

  return (
    <Card className="border-primary/20 bg-card/70 p-5 backdrop-blur-sm">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <div className="rounded-md bg-primary/15 p-1.5">
            <Repeat2 className="h-4 w-4 text-primary" />
          </div>
          <div>
            <h2 className="text-sm font-semibold">Dominant-category flips after normalization</h2>
            <p className="text-xs text-muted-foreground">
              How often normalization changes the winning ontology category, per scope, over time.
            </p>
          </div>
        </div>
        <div className="ml-auto flex items-center gap-1.5">
          {(["day", "week"] as Grain[]).map((g) => (
            <Button
              key={g}
              size="sm"
              variant={grain === g ? "default" : "outline"}
              className="h-7 px-2 text-[11px] capitalize"
              onClick={() => setGrain(g)}
            >
              {g === "day" ? "Daily" : "Weekly"}
            </Button>
          ))}
          <Button size="sm" variant="ghost" className="h-7 px-2" onClick={load} disabled={loading}>
            {loading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" />
            )}
          </Button>
        </div>
      </div>

      <div className="mt-4 grid gap-3 lg:grid-cols-3">
        {perScope.map((s) => (
          <div key={s.key} className="rounded-lg border border-border bg-background/40 p-3">
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium">{s.label}</span>
              <Badge variant="outline" className="ml-auto font-mono text-[10px]">
                {Math.round(s.rate * 100)}% flip rate
              </Badge>
            </div>
            <p className="mt-1 text-[11px] text-muted-foreground">
              {s.measured > 0
                ? `${s.flips} of ${s.measured} comparable analyses flipped`
                : "no raw baselines stored yet"}
              {s.total > s.measured ? ` • ${s.total - s.measured} without raw scores` : ""}
            </p>

            <div className="mt-3 flex h-24 items-end gap-1">
              {s.buckets.map((b) => {
                const h = (b.measured / maxBucket) * 100;
                const fh = b.measured > 0 ? (b.flips / b.measured) * 100 : 0;
                return (
                  <div key={b.label} className="group flex flex-1 flex-col items-center gap-1">
                    <div
                      className="relative w-full overflow-hidden rounded-sm bg-muted"
                      style={{ height: `${Math.max(h, b.measured > 0 ? 6 : 2)}%` }}
                      title={`${b.label}: ${b.flips} flips / ${b.measured} comparable (${b.total} total)`}
                    >
                      <div
                        className="absolute bottom-0 w-full rounded-sm bg-primary"
                        style={{ height: `${fh}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="mt-1 flex gap-1 text-[9px] text-muted-foreground">
              {s.buckets.map((b, i) => (
                <span key={b.label} className="flex-1 truncate text-center">
                  {i % 2 === 0 ? b.label : ""}
                </span>
              ))}
            </div>

            {s.topShifts.length > 0 && (
              <div className="mt-2 space-y-1">
                {s.topShifts.map(([k, n]) => (
                  <div key={k} className="flex items-center justify-between text-[11px]">
                    <span className="capitalize text-muted-foreground">{k}</span>
                    <span className="font-mono">{n}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      <p className="mt-3 text-[11px] text-muted-foreground">
        Bars show comparable analyses per {grain}; the filled portion is the share whose dominant
        category flipped. A rising flip rate means the current speech-skew settings are relabelling
        more ingests — worth reviewing against the impact breakdown.
      </p>
    </Card>
  );
};

export default CategoryFlipTrendWidget;
