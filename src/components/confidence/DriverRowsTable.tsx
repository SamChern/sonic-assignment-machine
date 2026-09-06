import { Fragment } from "react";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { ChevronDown, ChevronRight, FileText, Flag, Loader2, Users } from "lucide-react";
import { fmtBytes, type DrillData, type DriverRow } from "@/lib/confidenceBreakdown";

interface DriverRowsTableProps {
  driverRows: DriverRow[];
  openRow: number | null;
  drill: Record<number, DrillData>;
  drillLoading: number | null;
  rowSupport: (share: unknown, factor?: number) => number;
  threshold: number;
  onRowClick: (index: number, row: DriverRow) => void;
}

const DriverRowsTable = ({
  driverRows,
  openRow,
  drill,
  drillLoading,
  rowSupport,
  threshold,
  onRowClick,
}: DriverRowsTableProps) => {
  return (
          <div className="mt-5">
            <p className="text-xs font-medium">Taxonomy rows that drove the score</p>
            <p className="text-[11px] text-muted-foreground">
              Select a row to drill into the source record, the fields that contributed, and the
              linked audience identifiers.
            </p>
            {driverRows.length === 0 ? (
              <p className="mt-2 text-sm text-muted-foreground">
                No summary rows recorded for this activation.
              </p>
            ) : (
              <div className="mt-2 overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="text-muted-foreground">
                    <tr className="border-b border-border">
                      <th className="py-1.5 pr-3 font-medium">Feed</th>
                      <th className="py-1.5 pr-3 font-medium">Taxonomy / category</th>
                      <th className="py-1.5 pr-3 font-medium">Uniques</th>
                      <th className="py-1.5 pr-3 font-medium">Signals</th>
                      <th className="py-1.5 pr-3 font-medium">Share</th>
                      <th className="py-1.5 pr-3 font-medium">Period</th>
                    </tr>
                  </thead>
                  <tbody>
                    {driverRows.map((r, i) => {
                      const isOpen = openRow === i;
                      const d = drill[i];
                      const rawEntries = Object.entries(r).filter(
                        ([k]) => k !== "feed" && k !== "object_key",
                      );
                      const support = rowSupport(r.share);
                      const flagged = support < threshold;
                      return (
                        <Fragment key={i}>
                          <tr
                            className={
                              "cursor-pointer border-b border-border/50 transition-smooth hover:bg-muted/40 " +
                              (flagged ? "bg-destructive/5" : "")
                            }
                            onClick={() => onRowClick(i, r)}
                          >
                            <td className="py-1.5 pr-3">
                              <span className="flex items-center gap-1">
                                {drillLoading === i ? (
                                  <Loader2 className="h-3 w-3 animate-spin" />
                                ) : isOpen ? (
                                  <ChevronDown className="h-3 w-3 text-primary" />
                                ) : (
                                  <ChevronRight className="h-3 w-3 text-muted-foreground" />
                                )}
                                <Badge variant="outline" className="text-[10px]">
                                  {r.feed}
                                </Badge>
                              </span>
                            </td>
                            <td className="py-1.5 pr-3">
                              <span className="flex flex-wrap items-center gap-1.5">
                                {[r.TaxonomyName, r.CategoryName].filter(Boolean).join(" · ") || "—"}
                                {flagged && (
                                  <Badge
                                    variant="destructive"
                                    className="gap-1 text-[10px]"
                                    title={`support ${support.toFixed(3)} < threshold ${threshold.toFixed(2)}`}
                                  >
                                    <Flag className="h-2.5 w-2.5" />
                                    low {support.toFixed(2)}
                                  </Badge>
                                )}
                              </span>
                            </td>
                            <td className="py-1.5 pr-3">{r.uniques ?? "—"}</td>
                            <td className="py-1.5 pr-3">{r.signals ?? "—"}</td>
                            <td className="py-1.5 pr-3">
                              {r.share != null ? `${(Number(r.share) * 100).toFixed(0)}%` : "—"}
                            </td>
                            <td className="py-1.5 pr-3">{r.period ?? "—"}</td>
                          </tr>
                          {isOpen && (
                            <tr className="border-b border-border/50">
                              <td colSpan={6} className="p-0">
                                <div className="space-y-3 bg-muted/20 px-3 py-3">
                                  {/* source file */}
                                  <div className="rounded-md border border-border bg-card/60 p-3">
                                    <div className="flex items-center gap-1.5 text-[11px] font-medium">
                                      <FileText className="h-3.5 w-3.5 text-primary" />
                                      Source record
                                    </div>
                                    <p className="mt-1 break-all font-mono text-[10px] text-muted-foreground">
                                      {r.object_key ?? "object key not recorded on this signal block"}
                                    </p>
                                    {d?.file ? (
                                      <div className="mt-2 grid gap-2 sm:grid-cols-3">
                                        {(
                                          [
                                            ["report type", d.file.report_type],
                                            ["status", d.file.status],
                                            ["partition", d.file.partition_date ?? "—"],
                                            ["size", fmtBytes(d.file.size_bytes)],
                                            [
                                              "rows",
                                              `${d.file.processed_rows}/${d.file.total_rows} ok · ${d.file.failed_rows} failed`,
                                            ],
                                            [
                                              "finished",
                                              d.file.finished_at
                                                ? new Date(d.file.finished_at).toLocaleString()
                                                : "—",
                                            ],
                                          ] as const
                                        ).map(([k, v]) => (
                                          <div key={k}>
                                            <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                                              {k}
                                            </p>
                                            <p className="text-[11px]">{v}</p>
                                          </div>
                                        ))}
                                        {d.file.error_message && (
                                          <p className="sm:col-span-3 text-[11px] text-destructive">
                                            {d.file.error_message}
                                          </p>
                                        )}
                                      </div>
                                    ) : (
                                      <p className="mt-2 text-[11px] text-muted-foreground">
                                        No ingest-ledger entry found for this object key.
                                      </p>
                                    )}
                                  </div>

                                  {/* raw fields */}
                                  <div className="rounded-md border border-border bg-card/60 p-3">
                                    <p className="text-[11px] font-medium">
                                      Fields that contributed
                                    </p>
                                    <div className="mt-2 grid gap-x-4 gap-y-1 sm:grid-cols-2">
                                      {rawEntries.map(([k, v]) => (
                                        <div
                                          key={k}
                                          className="flex items-baseline justify-between gap-3 border-b border-border/40 py-0.5"
                                        >
                                          <span className="font-mono text-[10px] text-muted-foreground">
                                            {k}
                                          </span>
                                          <span className="break-all text-right text-[11px]">
                                            {v === null || v === undefined || v === ""
                                              ? "—"
                                              : String(v)}
                                          </span>
                                        </div>
                                      ))}
                                    </div>
                                  </div>

                                  {/* mapped nodes */}
                                  <div className="rounded-md border border-border bg-card/60 p-3">
                                    <p className="text-[11px] font-medium">
                                      Ontology nodes this row resolved to
                                    </p>
                                    {d && d.matchedTags.length > 0 ? (
                                      <div className="mt-2 space-y-2">
                                        {d.matchedTags.map((t, ti) => (
                                          <div key={ti} className="flex items-center gap-3">
                                            <span className="w-56 shrink-0 truncate text-[11px]">
                                              {t.taxonomy_nodes?.label ?? "unknown node"}
                                            </span>
                                            <Progress
                                              value={Math.min(100, Number(t.weight) * 100)}
                                              className="h-1.5"
                                            />
                                            <span className="w-20 shrink-0 text-right font-mono text-[10px] text-muted-foreground">
                                              w {Number(t.weight).toFixed(2)}
                                            </span>
                                          </div>
                                        ))}
                                        <div className="flex flex-wrap gap-1">
                                          {(d.matchedCodes.length
                                            ? d.matchedCodes
                                            : d.matchedTags.map((t) => t.taxonomy_nodes?.code ?? "")
                                          )
                                            .filter(Boolean)
                                            .map((c) => (
                                              <Badge
                                                key={c}
                                                variant="secondary"
                                                className="font-mono text-[10px]"
                                              >
                                                {c}
                                              </Badge>
                                            ))}
                                        </div>
                                        <p className="text-[10px] text-muted-foreground">
                                          contribution ≈ share{" "}
                                          {r.share != null ? Number(r.share).toFixed(2) : "—"} × node
                                          weight — this row carries{" "}
                                          {r.share != null
                                            ? `${(Number(r.share) * 100).toFixed(0)}%`
                                            : "an unknown share"}{" "}
                                          of the profile's tagged evidence.
                                        </p>
                                      </div>
                                    ) : (
                                      <p className="mt-2 text-[11px] text-muted-foreground">
                                        No taxonomy node matched this row's category label.
                                      </p>
                                    )}
                                  </div>

                                  {/* roster */}
                                  <div className="rounded-md border border-border bg-card/60 p-3">
                                    <div className="flex items-center gap-1.5 text-[11px] font-medium">
                                      <Users className="h-3.5 w-3.5 text-primary" />
                                      Linked audience records ({d?.rosterCount ?? 0})
                                    </div>
                                    {d && d.roster.length > 0 ? (
                                      <div className="mt-2 space-y-1">
                                        {d.roster.map((ro) => (
                                          <div
                                            key={ro.primary_identifier}
                                            className="flex items-center justify-between gap-3 border-b border-border/40 py-0.5"
                                          >
                                            <span className="break-all font-mono text-[10px]">
                                              {ro.primary_identifier}
                                            </span>
                                            <span className="shrink-0 text-[10px] text-muted-foreground">
                                              {ro.observation_count} obs
                                              {ro.last_seen_at
                                                ? ` · ${new Date(ro.last_seen_at).toLocaleDateString()}`
                                                : ""}
                                            </span>
                                          </div>
                                        ))}
                                        {d.rosterCount > d.roster.length && (
                                          <p className="text-[10px] text-muted-foreground">
                                            showing {d.roster.length} of {d.rosterCount} roster rows
                                          </p>
                                        )}
                                      </div>
                                    ) : (
                                      <p className="mt-2 text-[11px] text-muted-foreground">
                                        No roster identifiers are linked to this profile yet.
                                      </p>
                                    )}
                                  </div>
                                </div>
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      );
                    })}

                  </tbody>
                </table>
              </div>
            )}
          </div>
  );
};

export default DriverRowsTable;
