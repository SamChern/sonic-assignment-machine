import { Badge } from "@/components/ui/badge";
import { GitCompare, Loader2, TrendingUp } from "lucide-react";
import {
  SCORE_KEYS,
  type Bundle,
  type DriverRow,
  type TagRow,
  computeDriverRows,
  computeMath,
} from "@/lib/confidenceBreakdown";

type Math = ReturnType<typeof computeMath>;

interface ComparisonSectionProps {
  activation: string;
  compareId: string;
  compareLoading: boolean;
  compare: Bundle | null;
  math: Math;
  compareMath: Math;
  analysis: Record<string, number | string | null> | null;
  tags: TagRow[];
  driverRows: DriverRow[];
  compareDriverRows: ReturnType<typeof computeDriverRows>;
  rowMovers: { ranked: { key: string; label: string; a: number; b: number; delta: number }[]; top: Map<string, number> };
  scoreMovers: { ranked: { k: string; label: string; a: number; b: number; delta: number }[]; top: Map<string, number> };
  rowSupport: (share: unknown, factor?: number) => number;
  threshold: number;
  rowKey: (r: { TaxonomyName?: string | null; CategoryName?: string | null }) => string;
}

const ComparisonSection = ({
  activation,
  compareId,
  compareLoading,
  compare,
  math,
  compareMath,
  analysis,
  tags,
  driverRows,
  compareDriverRows,
  rowMovers,
  scoreMovers,
  rowSupport,
  threshold,
  rowKey,
}: ComparisonSectionProps) => {
  if (!compareLoading && !compare) return null;
  return (
            <div className="mt-6 rounded-lg border border-primary/30 bg-primary/5 p-4">
              <div className="flex items-center gap-2">
                <GitCompare className="h-4 w-4 text-primary" />
                <h3 className="text-sm font-semibold">
                  Comparison — activation {activation.trim()} vs {compareId}
                </h3>
                {compareLoading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
              </div>

              {compare && (
                <>
                  {/* confidence math side by side */}
                  <div className="mt-3 overflow-x-auto">
                    <table className="w-full min-w-[520px] text-xs">
                      <thead>
                        <tr className="border-b border-border text-left text-muted-foreground">
                          <th className="py-1.5 pr-3 font-medium">Confidence input</th>
                          <th className="py-1.5 pr-3 font-medium">{activation.trim()}</th>
                          <th className="py-1.5 pr-3 font-medium">{compareId}</th>
                          <th className="py-1.5 font-medium">Delta</th>
                        </tr>
                      </thead>
                      <tbody className="font-mono">
                        {[
                          ["score stddev", math?.stddev, compareMath?.stddev, 1],
                          ["spread factor", math?.spread, compareMath?.spread, 3],
                          ["evidence factor", math?.tier.factor, compareMath?.tier.factor, 1],
                          ["confidence", math?.confidence, compareMath?.confidence, 3],
                        ].map(([label, a, b, dp]) => {
                          const av = typeof a === "number" ? a : null;
                          const bv = typeof b === "number" ? b : null;
                          const d = av !== null && bv !== null ? bv - av : null;
                          const fixed = dp as number;
                          return (
                            <tr key={String(label)} className="border-b border-border/50">
                              <td className="py-1.5 pr-3 font-sans">{String(label)}</td>
                              <td className="py-1.5 pr-3">{av !== null ? av.toFixed(fixed) : "—"}</td>
                              <td className="py-1.5 pr-3">{bv !== null ? bv.toFixed(fixed) : "—"}</td>
                              <td
                                className={
                                  "py-1.5 " +
                                  (d === null
                                    ? "text-muted-foreground"
                                    : d > 0
                                      ? "text-primary"
                                      : d < 0
                                        ? "text-destructive"
                                        : "text-muted-foreground")
                                }
                              >
                                {d === null ? "—" : `${d > 0 ? "+" : ""}${d.toFixed(fixed)}`}
                              </td>
                            </tr>
                          );
                        })}
                        <tr>
                          <td className="py-1.5 pr-3 font-sans">evidence tier</td>
                          <td className="py-1.5 pr-3 font-sans capitalize">{math?.tier.kind ?? "—"}</td>
                          <td className="py-1.5 pr-3 font-sans capitalize">{compareMath?.tier.kind ?? "—"}</td>
                          <td className="py-1.5 font-sans text-muted-foreground">
                            {math && compareMath && math.tier.kind !== compareMath.tier.kind
                              ? "different evidence path"
                              : "same"}
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </div>

                  {/* fastest movers */}
                  {(rowMovers.ranked.length > 0 || scoreMovers.ranked.length > 0) && (
                    <div className="mt-4 rounded-md border border-primary/40 bg-primary/10 p-3">
                      <div className="flex items-center gap-1.5 text-xs font-semibold">
                        <TrendingUp className="h-3.5 w-3.5 text-primary" />
                        Fastest movers ({activation.trim()} → {compareId})
                      </div>
                      <div className="mt-2 grid gap-3 sm:grid-cols-2">
                        <div>
                          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                            Driver rows by support shift
                          </p>
                          <ul className="mt-1 space-y-1">
                            {rowMovers.ranked.length === 0 && (
                              <li className="text-[11px] text-muted-foreground">No row-level shift.</li>
                            )}
                            {rowMovers.ranked.slice(0, 3).map((m, i) => (
                              <li key={m.key} className="flex items-center gap-2 text-[11px]">
                                <Badge variant="outline" className="h-4 px-1 font-mono text-[10px]">
                                  #{i + 1}
                                </Badge>
                                <span className="truncate">{m.label}</span>
                                <span
                                  className={
                                    "ml-auto font-mono " +
                                    (m.delta > 0 ? "text-primary" : "text-destructive")
                                  }
                                >
                                  {m.a.toFixed(2)} → {m.b.toFixed(2)} ({m.delta > 0 ? "+" : ""}
                                  {m.delta.toFixed(2)})
                                </span>
                              </li>
                            ))}
                          </ul>
                        </div>
                        <div>
                          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                            Category scores by point shift
                          </p>
                          <ul className="mt-1 space-y-1">
                            {scoreMovers.ranked.length === 0 && (
                              <li className="text-[11px] text-muted-foreground">No category shift ≥ 1 point.</li>
                            )}
                            {scoreMovers.ranked.slice(0, 3).map((m, i) => (
                              <li key={m.k} className="flex items-center gap-2 text-[11px]">
                                <Badge variant="outline" className="h-4 px-1 font-mono text-[10px]">
                                  #{i + 1}
                                </Badge>
                                <span className="truncate">{m.label}</span>
                                <span
                                  className={
                                    "ml-auto font-mono " +
                                    (m.delta > 0 ? "text-primary" : "text-destructive")
                                  }
                                >
                                  {Math.round(m.a)} → {Math.round(m.b)} ({m.delta > 0 ? "+" : ""}
                                  {Math.round(m.delta)})
                                </span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* driver rows side by side */}

                  <div className="mt-4 grid gap-4 lg:grid-cols-2">
                    {[
                      { id: activation.trim(), rows: driverRows, cat: analysis?.category, nodes: tags.length, factor: math?.tier.factor },
                      { id: compareId, rows: compareDriverRows, cat: compare.analysis?.category, nodes: compare.tags.length, factor: compareMath?.tier.factor },
                    ].map((side) => (
                      <div key={side.id} className="rounded-md border border-border bg-card/60 p-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-xs font-semibold">Activation {side.id}</p>
                          {side.cat ? (
                            <Badge variant="secondary">{String(side.cat)}</Badge>
                          ) : (
                            <span className="text-[11px] text-muted-foreground">not scored</span>
                          )}
                          <span className="ml-auto text-[11px] text-muted-foreground">
                            {side.rows.length} driver row{side.rows.length === 1 ? "" : "s"} · {side.nodes} node
                            {side.nodes === 1 ? "" : "s"}
                          </span>
                        </div>
                        <div className="overflow-x-auto"><table className="mt-2 w-full text-[11px]">
                            <thead>
                              <tr className="border-b border-border text-left text-muted-foreground">
                                <th className="py-1 pr-2 font-medium">Feed</th>
                                <th className="py-1 pr-2 font-medium">Category</th>
                                <th className="py-1 pr-2 font-medium">Share</th>
                                <th className="py-1 font-medium">Uniques</th>
                              </tr>
                            </thead>
                            <tbody>
                              {side.rows.length === 0 && (
                                <tr>
                                  <td colSpan={4} className="py-2 text-muted-foreground">
                                    No driver rows ingested.
                                  </td>
                                </tr>
                              )}
                              {side.rows.slice(0, 10).map((r, i) => {
                                const sup = rowSupport(r.share, side.factor);
                                const flg = sup < threshold;
                                const rank = rowMovers.top.get(rowKey(r));
                                return (
                                <tr
                                  key={i}
                                  className={
                                    "border-b border-border/50 " +
                                    (rank
                                      ? "bg-primary/15 ring-1 ring-inset ring-primary/40"
                                      : flg
                                        ? "bg-destructive/5"
                                        : "")
                                  }
                                >
                                  <td className="py-1 pr-2 text-muted-foreground">{r.feed}</td>
                                  <td className="py-1 pr-2">
                                    {r.TaxonomyName || r.CategoryName || "—"}
                                    {flg && <span className="ml-1 text-destructive">⚑</span>}
                                    {rank && (
                                      <Badge
                                        variant="outline"
                                        className="ml-1 h-4 border-primary/50 px-1 font-mono text-[10px] text-primary"
                                      >
                                        mover #{rank}
                                      </Badge>
                                    )}
                                  </td>
                                  <td className="py-1 pr-2 font-mono">
                                    {r.share != null ? `${(Number(r.share) * 100).toFixed(0)}%` : "—"}
                                  </td>
                                  <td className="py-1 font-mono">{Number(r.uniques) || 0}</td>
                                </tr>
                                );
                              })}

                            </tbody>
                        </table></div>
                      </div>
                    ))}
                  </div>

                  {/* per-category deltas */}
                  <div className="mt-4 grid gap-2 sm:grid-cols-3">
                    {SCORE_KEYS.map(([k, label]) => {
                      const a = Number(analysis?.[k]) || 0;
                      const b = Number(compare.analysis?.[k]) || 0;
                      const d = b - a;
                      const rank = scoreMovers.top.get(String(k));
                      return (
                        <div
                          key={k}
                          className={
                            "rounded-md border px-3 py-2 " +
                            (rank
                              ? "border-primary/50 bg-primary/15 ring-1 ring-inset ring-primary/30"
                              : "border-border bg-card/60")
                          }
                        >
                          <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
                            {label}
                            {rank && (
                              <Badge
                                variant="outline"
                                className="h-4 border-primary/50 px-1 font-mono text-[10px] text-primary"
                              >
                                mover #{rank}
                              </Badge>
                            )}
                          </div>

                          <p className="text-sm font-semibold">
                            {Math.round(a)} → {Math.round(b)}{" "}
                            <span
                              className={
                                "text-[11px] font-mono " +
                                (d > 0 ? "text-primary" : d < 0 ? "text-destructive" : "text-muted-foreground")
                              }
                            >
                              {d > 0 ? "+" : ""}
                              {Math.round(d)}
                            </span>
                          </p>
                        </div>
                      );

                    })}
                  </div>
                </>
              )}
            </div>
  );
};

export default ComparisonSection;
