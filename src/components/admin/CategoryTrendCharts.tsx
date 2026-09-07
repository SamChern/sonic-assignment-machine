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

/** One category's line over time, drawn as a small inline SVG sparkline. */
const CategoryLine = ({
  category,
  points,
}: {
  category: CategoryKey;
  points: CategoryTrendPoint[];
}) => {
  const values = points.map((p) => p.scores[category] ?? 0);
  const first = values[0] ?? 0;
  const last = values[values.length - 1] ?? 0;
  const delta = Math.round((last - first) * 10) / 10;
  const avg = values.length
    ? Math.round((values.reduce((s, v) => s + v, 0) / values.length) * 10) / 10
    : 0;

  const width = 260;
  const height = 72;
  const step = values.length > 1 ? width / (values.length - 1) : 0;
  const y = (v: number) => height - (Math.max(0, Math.min(100, v)) / 100) * height;
  const line = values.map((v, i) => `${i === 0 ? "M" : "L"}${(i * step).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const area = values.length
    ? `${line} L${((values.length - 1) * step).toFixed(1)},${height} L0,${height} Z`
    : "";
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
        now {last.toFixed(1)} · {delta === 0 ? "flat" : `${delta > 0 ? "+" : ""}${delta.toFixed(1)} over the window`}
      </p>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        className="mt-3 h-20 w-full"
        role="img"
        aria-label={`${category} score over time, from ${first.toFixed(1)} to ${last.toFixed(1)}`}
      >
        <line x1="0" y1={y(50)} x2={width} y2={y(50)} stroke="hsl(var(--border))" strokeDasharray="3 3" strokeWidth="1" />
        {area ? <path d={area} fill={stroke} opacity="0.12" /> : null}
        <path d={line} fill="none" stroke={stroke} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        {values.map((v, i) => (
          <circle key={i} cx={i * step} cy={y(v)} r="2" fill={stroke} />
        ))}
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
