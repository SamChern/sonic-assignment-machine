import { useMemo } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { CATEGORY_KEYS, type CategoryKey } from "@/lib/enterpriseSchema";
import { histogramMedian, type ListenerDataset } from "@/hooks/useListenerDataset";

const pct = (part: number, whole: number) => (whole ? Math.round((part / whole) * 1000) / 10 : 0);
const num = (n: number | null | undefined) => (n ?? 0).toLocaleString();

/** Distribution, trend and breakdown panels for the real listener population. */
const ListenerDatasetDashboard = ({
  data,
  loading,
}: {
  data: ListenerDataset | null;
  loading: boolean;
}) => {
  const trendMax = useMemo(
    () => Math.max(1, ...(data?.trend ?? []).map((t) => t.count)),
    [data],
  );

  if (loading && !data) {
    return (
      <div className="space-y-3">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-28 w-full" />
        ))}
      </div>
    );
  }

  if (!data) return null;

  const t = data.totals;

  return (
    <div className="space-y-6">
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          { label: "Listener profiles", value: num(t.profiles), gradient: "var(--gradient-cognitive)" },
          { label: "Identifiers behind them", value: num(t.identifiers), gradient: "var(--gradient-contextual)" },
          {
            label: "With sampled audio",
            value: `${num(t.audio_grounded)} · ${pct(t.audio_grounded, t.profiles)}%`,
            gradient: "var(--gradient-social)",
          },
          {
            label: "Average confidence",
            value: (t.avg_confidence ?? 0).toFixed(3),
            gradient: "var(--gradient-artistic)",
          },
        ].map((m) => (
          <Card key={m.label} className="relative overflow-hidden border-border/60 p-4">
            <span aria-hidden className="absolute inset-x-0 top-0 h-1" style={{ background: m.gradient }} />
            <p className="text-xs text-muted-foreground">{m.label}</p>
            <p
              className="truncate bg-clip-text text-xl font-semibold text-transparent sm:text-2xl"
              style={{ backgroundImage: m.gradient }}
            >
              {m.value}
            </p>
          </Card>
        ))}
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold text-muted-foreground">Score distribution</h2>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {CATEGORY_KEYS.map((key: CategoryKey) => {
            const axis = data.axes[key];
            if (!axis) return null;
            const max = Math.max(1, ...axis.histogram);
            return (
              <Card key={key} className="border-border/60 p-4">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-semibold capitalize text-foreground">{key}</p>
                  <Badge variant="outline" className="text-[11px]">
                    avg {axis.mean.toFixed(1)}
                  </Badge>
                </div>
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  typical {histogramMedian(axis.histogram)} · spread ±{axis.spread.toFixed(1)}
                </p>
                <div
                  className="mt-3 flex h-24 items-end gap-1"
                  role="img"
                  aria-label={`${key} score distribution across ten bands`}
                >
                  {axis.histogram.map((n, i) => (
                    <div key={i} className="flex-1">
                      <div
                        className="w-full rounded-t"
                        style={{
                          height: `${Math.max(2, (n / max) * 96)}px`,
                          background: `hsl(var(--category-${key}))`,
                        }}
                        title={`${i * 10}-${i * 10 + 9}: ${num(n)} profiles`}
                      />
                    </div>
                  ))}
                </div>
                <div className="mt-1 flex justify-between text-[10px] text-muted-foreground">
                  <span>0</span>
                  <span>50</span>
                  <span>100</span>
                </div>
              </Card>
            );
          })}
        </div>
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold text-muted-foreground">
          Activity, last {data.window_days} days
        </h2>
        <Card className="border-border/60 p-4">
          {!data.trend.length ? (
            <p className="text-xs text-muted-foreground">No listener activity in this window.</p>
          ) : (
            <>
              <div className="flex h-32 items-end gap-1 overflow-x-auto">
                {data.trend.map((d) => (
                  <div key={d.day} className="flex min-w-[6px] flex-1 flex-col items-center gap-1">
                    <div
                      className="w-full rounded-t bg-primary/70"
                      style={{ height: `${Math.max(2, (d.count / trendMax) * 120)}px` }}
                      title={`${d.day}: ${num(d.count)} profiles seen, confidence ${d.avg_confidence}`}
                    />
                  </div>
                ))}
              </div>
              <div className="mt-2 flex justify-between text-[10px] text-muted-foreground">
                <span>{data.trend[0]?.day}</span>
                <span>{data.trend[data.trend.length - 1]?.day}</span>
              </div>
            </>
          )}
        </Card>
      </section>

      <section className="grid gap-3 lg:grid-cols-2">
        <Card className="border-border/60 p-4">
          <h2 className="text-sm font-semibold text-foreground">Evidence quality</h2>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            How each profile was grounded, and how confident it is.
          </p>
          <ul className="mt-3 space-y-2">
            {data.grounding.map((g) => (
              <li key={g.level}>
                <div className="flex items-baseline justify-between gap-2 text-xs">
                  <span className="capitalize text-foreground">{g.level}</span>
                  <span className="text-muted-foreground">
                    {num(g.count)} · {pct(g.count, t.profiles)}% · confidence {g.avg_confidence}
                  </span>
                </div>
                <div className="mt-1 h-1.5 overflow-hidden rounded bg-muted">
                  <div
                    className="h-full rounded bg-primary"
                    style={{ width: `${pct(g.count, t.profiles)}%` }}
                  />
                </div>
              </li>
            ))}
          </ul>
        </Card>

        <Card className="border-border/60 p-4">
          <h2 className="text-sm font-semibold text-foreground">Population size per profile</h2>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            How many identifiers roll up into a single listener profile.
          </p>
          <ul className="mt-3 space-y-2">
            {data.reach.map((r) => (
              <li key={r.band}>
                <div className="flex items-baseline justify-between gap-2 text-xs">
                  <span className="text-foreground">{r.band}</span>
                  <span className="text-muted-foreground">
                    {num(r.count)} · {pct(r.count, t.profiles)}%
                  </span>
                </div>
                <div className="mt-1 h-1.5 overflow-hidden rounded bg-muted">
                  <div
                    className="h-full rounded bg-accent"
                    style={{ width: `${pct(r.count, t.profiles)}%` }}
                  />
                </div>
              </li>
            ))}
          </ul>
        </Card>
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold text-muted-foreground">
          Most common tags (sample of {num(data.tag_sample)} profiles)
        </h2>
        <Card className="border-border/60 p-4">
          {!data.top_tags.length ? (
            <p className="text-xs text-muted-foreground">No tags recorded yet.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {data.top_tags.map((tag) => (
                <Badge key={tag.code} variant="outline" className="text-[11px]">
                  {tag.code} · {num(tag.count)}
                </Badge>
              ))}
            </div>
          )}
        </Card>
      </section>
    </div>
  );
};

export default ListenerDatasetDashboard;
