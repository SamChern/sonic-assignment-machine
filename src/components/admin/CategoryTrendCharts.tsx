import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { CATEGORY_KEYS, type CategoryKey } from "@/lib/enterpriseSchema";
import { useCategoryScoreTrend, type CategoryTrendPoint } from "@/hooks/useCategoryScoreTrend";

const WINDOWS = [
  { days: 30, label: "30 days" },
  { days: 90, label: "90 days" },
  { days: 365, label: "12 months" },
];

const BUCKET_WORD: Record<string, string> = { day: "day", week: "week", month: "month" };

const num = (n: number) => n.toLocaleString();
const day = (iso: string | null) => (iso ? iso.slice(0, 10) : "—");

/** One category's line over time. Periods with no analyses stay blank. */
const CategoryLine = ({
  category,
  points,
}: {
  category: CategoryKey;
  points: CategoryTrendPoint[];
}) => {
  const values = points.map((p) => (p.scores ? (p.scores[category] ?? 0) : null));
  const present = values.filter((v): v is number => v !== null);
  const first = present[0] ?? 0;
  const last = present[present.length - 1] ?? 0;
  const delta = Math.round((last - first) * 10) / 10;
  const avg = present.length
    ? Math.round((present.reduce((s, v) => s + v, 0) / present.length) * 10) / 10
    : 0;
  const gaps = values.length - present.length;

  const width = 260;
  const height = 72;
  const step = values.length > 1 ? width / (values.length - 1) : 0;
  const y = (v: number) => height - (Math.max(0, Math.min(100, v)) / 100) * height;
  // Each run of consecutive measured periods is its own path, so blank periods
  // read as breaks rather than a line dropping to zero.
  const segments: string[] = [];
  let run: string[] = [];
  values.forEach((v, i) => {
    if (v === null) {
      if (run.length > 1) segments.push(run.join(" "));
      run = [];
      return;
    }
    run.push(`${run.length === 0 ? "M" : "L"}${(i * step).toFixed(1)},${y(v).toFixed(1)}`);
  });
  if (run.length > 1) segments.push(run.join(" "));
  const stroke = `hsl(var(--category-${category}))`;

  return (
    <Card className="border-border/60 p-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-semibold capitalize text-foreground">{category}</p>
        <Badge variant="outline" className="text-[11px]">
          avg {avg.toFixed(1)}
        </Badge>
      </div>
      <p className="mt-0.5 text-[11px] text-muted-foreground">
        now {last.toFixed(1)} ·{" "}
        {delta === 0 ? "flat" : `${delta > 0 ? "+" : ""}${delta.toFixed(1)} over the window`}
        {gaps ? ` · ${gaps} period${gaps === 1 ? "" : "s"} with no analyses` : ""}
      </p>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        className="mt-3 h-20 w-full"
        role="img"
        aria-label={`${category} score over time, from ${first.toFixed(1)} to ${last.toFixed(1)}${gaps ? `, with ${gaps} periods that have no analyses` : ""}`}
      >
        <line x1="0" y1={y(50)} x2={width} y2={y(50)} stroke="hsl(var(--border))" strokeDasharray="3 3" strokeWidth="1" />
        {segments.map((d, i) => (
          <path key={i} d={d} fill="none" stroke={stroke} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        ))}
        {values.map((v, i) =>
          v === null ? null : <circle key={i} cx={i * step} cy={y(v)} r="2" fill={stroke} />,
        )}
      </svg>
      <div className="mt-1 flex justify-between text-[10px] text-muted-foreground">
        <span>{points[0]?.bucket ?? ""}</span>
        <span>{points[points.length - 1]?.bucket ?? ""}</span>
      </div>
    </Card>
  );
};


/** Six per-category score histories, one small chart each. */
const CategoryTrendCharts = () => {
  const [days, setDays] = useState(90);
  const { data, loading, error, reload } = useCategoryScoreTrend(days);
  const points = useMemo(() => data?.points ?? [], [data]);
  const analysed = useMemo(() => points.reduce((s, p) => s + p.count, 0), [points]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          {loading && !data
            ? "Reading score history…"
            : `${num(analysed)} analyses, grouped by ${BUCKET_WORD[data?.bucket ?? "day"] ?? "day"}.`}
        </p>
        <div className="flex flex-wrap items-center gap-1">
          {WINDOWS.map((w) => (
            <Button
              key={w.days}
              size="sm"
              variant={days === w.days ? "default" : "outline"}
              className="h-7 px-2 text-xs"
              onClick={() => setDays(w.days)}
            >
              {w.label}
            </Button>
          ))}
          <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => void reload()}>
            Refresh
          </Button>
        </div>
      </div>

      {error ? <p className="text-xs text-destructive">{error}</p> : null}

      {loading && !data ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {CATEGORY_KEYS.map((k) => (
            <Skeleton key={k} className="h-40 w-full" />
          ))}
        </div>
      ) : !points.length ? (
        <p className="text-xs text-muted-foreground">No analyses in this window yet.</p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {CATEGORY_KEYS.map((key: CategoryKey) => (
            <CategoryLine key={key} category={key} points={points} />
          ))}
        </div>
      )}
    </div>
  );
};

export default CategoryTrendCharts;
