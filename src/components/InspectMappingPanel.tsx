import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ChevronsUpDown, Loader2, Microscope, RefreshCw, X } from "lucide-react";
import {
  REPORT_TYPES,
  type ReportType,
  inspectRow,
  parseRowInput,
} from "@/lib/intuiziMapping";

const SAMPLE: Record<ReportType, string> = {
  ctv: `primary_identifier,contentgenre,contenttype,channelname,iab_cats,useragent
a1b2-c3d4,Drama,Series,Peacock,"IAB1|IAB1-7",Roku/12.5`,
  apps: `primary_identifier,CategoryName,TaxonomyName,Signals,platform
a1b2-c3d4,Music & Audio,Streaming Audio,42,ios`,
  visitation: `primary_identifier,brandName,d_utc,distance
a1b2-c3d4,Starbucks,2026-08-20T19:12:00Z,40`,
  demographics: `primary_identifier,age_range,income_range,household_composition
a1b2-c3d4,25-34,75k-100k,Married with kids`,
  origin: `primary_identifier,origin_type,state,travel_type
a1b2-c3d4,Suburban,CA,Commuter`,
};

interface StoredIdentifier {
  id: string;
  primary_identifier: string;
  ctv_signals: Record<string, unknown> | null;
  apps_signals: Record<string, unknown> | null;
  visitation_signals: Record<string, unknown> | null;
  demographics_signals: Record<string, unknown> | null;
  origin_signals: Record<string, unknown> | null;
  audio_source_id: string | null;
}

type Inspection = ReturnType<typeof inspectRow>;

const flattenSignals = (
  signals: Record<string, unknown> | null,
): Record<string, unknown> => {
  if (!signals) return {};
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(signals)) {
    if (k === "meta" && v && typeof v === "object") {
      for (const [mk, mv] of Object.entries(v as Record<string, unknown>)) out[mk] = mv;
    } else if (Array.isArray(v)) {
      out[k] = v.join("|");
    } else {
      out[k] = v;
    }
  }
  return out;
};

/** First signal group with content, plus its report type. */
const primaryGroup = (
  rec: StoredIdentifier,
): [ReportType, Record<string, unknown> | null] => {
  const groups: [ReportType, Record<string, unknown> | null][] = [
    ["ctv", rec.ctv_signals],
    ["apps", rec.apps_signals],
    ["visitation", rec.visitation_signals],
    ["demographics", rec.demographics_signals],
    ["origin", rec.origin_signals],
  ];
  return groups.find(([, v]) => v && Object.keys(v).length > 0) ?? ["ctv", null];
};

const rowFor = (rec: StoredIdentifier): Record<string, unknown> => {
  const [, signals] = primaryGroup(rec);
  return { primary_identifier: rec.primary_identifier, ...flattenSignals(signals) };
};

/* ------------------------------------------------------------ result block */

const ResultBlock = ({
  result,
  nodeIds,
  storedWeights,
  heading,
}: {
  result: Inspection;
  nodeIds: Record<string, string>;
  storedWeights: Record<string, number>;
  heading?: string;
}) => (
  <div className="space-y-3">
    {heading && (
      <p className="font-mono text-xs font-medium text-primary break-all">{heading}</p>
    )}
    <div className="rounded-md border border-border bg-muted/30 p-3 text-xs space-y-1">
      <p>
        <span className="text-muted-foreground">identifier: </span>
        <span className="font-mono">{result.identifier ?? "—"}</span>
      </p>
      <p>
        <span className="text-muted-foreground">source label: </span>
        {result.label}
      </p>
      <p>
        <span className="text-muted-foreground">tag weight: </span>
        {result.tagWeight.toFixed(2)}{" "}
        <span className="text-muted-foreground">
          ({result.confidenceReason}; ingest keeps the max across an identifier's rows)
        </span>
      </p>
      {result.skippedReason && <p className="text-destructive">{result.skippedReason}</p>}
    </div>

    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead className="text-muted-foreground">
          <tr className="border-b border-border">
            <th className="py-1.5 pr-2 text-left font-medium">Field</th>
            <th className="py-1.5 pr-2 text-left font-medium">Value</th>
            <th className="py-1.5 pr-2 text-left font-medium">Taxonomy node(s)</th>
            <th className="py-1.5 text-left font-medium">Weight</th>
          </tr>
        </thead>
        <tbody>
          {result.fields.map((f) => (
            <tr key={f.field} className="border-b border-border/60 align-top">
              <td className="py-2 pr-2">
                <p className="font-mono">{f.field}</p>
                <p className="text-[11px] text-muted-foreground">
                  {f.role}
                  {f.note ? ` · ${f.note}` : ""}
                </p>
                {f.matchedAlias && f.matchedAlias !== f.field && (
                  <p className="text-[11px] text-muted-foreground">
                    matched column “{f.matchedAlias}”
                  </p>
                )}
              </td>
              <td className="py-2 pr-2 break-all">
                {f.value === null ? (
                  <span className="text-muted-foreground">missing</span>
                ) : Array.isArray(f.value) ? (
                  f.value.join(", ")
                ) : (
                  String(f.value)
                )}
              </td>
              <td className="py-2 pr-2">
                {f.tags.length === 0 ? (
                  <span className="text-muted-foreground">
                    {f.role === "tag" ? "—" : "not a tag source"}
                  </span>
                ) : (
                  <div className="space-y-1">
                    {f.tags.map((t) => (
                      <div key={t.code}>
                        <p className="font-mono break-all">{t.code}</p>
                        <div className="flex flex-wrap items-center gap-1 text-[11px] text-muted-foreground">
                          <span>parent {t.parent_code} ·</span>
                          {nodeIds[t.code] ? (
                            <Badge variant="outline" className="text-[10px] py-0">
                              existing node
                            </Badge>
                          ) : (
                            <Badge variant="secondary" className="text-[10px] py-0">
                              will be created
                            </Badge>
                          )}
                        </div>

                      </div>
                    ))}
                  </div>
                )}
              </td>
              <td className="py-2">
                {f.tags.length === 0 ? (
                  <span className="text-muted-foreground">—</span>
                ) : (
                  <div className="space-y-1">
                    {f.tags.map((t) => (
                      <p key={t.code}>
                        {(storedWeights[t.code] ?? result.tagWeight).toFixed(2)}
                        {storedWeights[t.code] !== undefined && (
                          <span className="text-[11px] text-muted-foreground"> stored</span>
                        )}
                      </p>
                    ))}
                  </div>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  </div>
);

/* ------------------------------------------------------------------ panel */

const InspectMappingPanel = () => {
  const [reportType, setReportType] = useState<ReportType>("ctv");
  const [raw, setRaw] = useState(SAMPLE.ctv);
  const [nodeIds, setNodeIds] = useState<Record<string, string>>({});
  const [weightsBySource, setWeightsBySource] = useState<Record<string, Record<string, number>>>(
    {},
  );
  const [identifiers, setIdentifiers] = useState<StoredIdentifier[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [resolving, setResolving] = useState(false);

  const selected = useMemo(
    () => selectedIds.map((id) => identifiers.find((i) => i.id === id)).filter(Boolean) as StoredIdentifier[],
    [selectedIds, identifiers],
  );

  /** Manual/single mode is driven by the textarea; multi mode by the selection. */
  const multi = selected.length > 1;

  const row = useMemo(() => parseRowInput(raw), [raw]);
  const singleResult = useMemo(
    () => (row ? inspectRow(reportType, row) : null),
    [row, reportType],
  );

  const multiResults = useMemo(
    () =>
      selected.map((rec) => {
        const [type] = primaryGroup(rec);
        return {
          rec,
          type,
          result: inspectRow(type, rowFor(rec)),
        };
      }),
    [selected],
  );

  const loadIdentifiers = useCallback(async () => {
    const { data } = await supabase
      .from("intuizi_identifiers")
      .select(
        "id, primary_identifier, ctv_signals, apps_signals, visitation_signals, demographics_signals, origin_signals, audio_source_id",
      )
      .order("updated_at", { ascending: false })
      .limit(50);
    setIdentifiers((data ?? []) as unknown as StoredIdentifier[]);
  }, []);

  useEffect(() => {
    loadIdentifiers();
  }, [loadIdentifiers]);

  /** Resolve which derived codes already exist as taxonomy nodes, plus live weights. */
  const resolveNodes = useCallback(async () => {
    const codes = Array.from(
      new Set(
        multi
          ? multiResults.flatMap((m) => m.result.tags.map((t) => t.code))
          : (singleResult?.tags ?? []).map((t) => t.code),
      ),
    );
    if (!codes.length) {
      setNodeIds({});
      setWeightsBySource({});
      return;
    }
    setResolving(true);
    const { data: nodes } = await supabase
      .from("taxonomy_nodes")
      .select("id, code")
      .in("code", codes);
    const map: Record<string, string> = {};
    for (const n of nodes ?? []) map[n.code as string] = n.id as string;
    setNodeIds(map);

    const sourceIds = selected
      .map((s) => s.audio_source_id)
      .filter((v): v is string => !!v);

    if (sourceIds.length && nodes?.length) {
      const { data: links } = await supabase
        .from("audio_source_tags")
        .select("audio_source_id, node_id, weight")
        .in("audio_source_id", sourceIds)
        .in("node_id", nodes.map((n) => n.id as string));
      const bySource: Record<string, Record<string, number>> = {};
      for (const l of links ?? []) {
        const code = Object.keys(map).find((c) => map[c] === l.node_id);
        if (!code) continue;
        const sid = l.audio_source_id as string;
        bySource[sid] = { ...(bySource[sid] ?? {}), [code]: Number(l.weight) };
      }
      setWeightsBySource(bySource);
    } else {
      setWeightsBySource({});
    }
    setResolving(false);
  }, [multi, multiResults, singleResult, selected]);

  useEffect(() => {
    resolveNodes();
  }, [resolveNodes]);

  const toggle = (id: string) => {
    setSelectedIds((prev) => {
      const next = prev.includes(id) ? prev.filter((v) => v !== id) : [...prev, id];
      // With exactly one selection, mirror it into the editable textarea.
      if (next.length === 1) {
        const rec = identifiers.find((i) => i.id === next[0]);
        if (rec) {
          const [type] = primaryGroup(rec);
          setReportType(type);
          setRaw(JSON.stringify(rowFor(rec), null, 2));
        }
      }
      return next;
    });
  };

  const clearSelection = () => setSelectedIds([]);

  const triggerLabel = !identifiers.length
    ? "none ingested yet"
    : selected.length === 0
      ? "Pick one or more…"
      : selected.length === 1
        ? selected[0].primary_identifier
        : `${selected.length} identifiers selected`;

  const singleWeights = selected[0]?.audio_source_id
    ? weightsBySource[selected[0].audio_source_id] ?? {}
    : {};

  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Microscope className="h-4 w-4 text-primary" />
        <h2 className="text-sm font-semibold">Inspect mapping</h2>
        <p className="text-xs text-muted-foreground">field → taxonomy node → tag weight</p>
        <Button variant="ghost" size="sm" className="ml-auto" onClick={loadIdentifiers}>
          <RefreshCw className="mr-1 h-3.5 w-3.5" />
          Reload identifiers
        </Button>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label className="text-xs">Report type</Label>
              <Select
                value={reportType}
                onValueChange={(v) => {
                  const t = v as ReportType;
                  setReportType(t);
                  setSelectedIds([]);
                  setRaw(SAMPLE[t]);
                }}
                disabled={multi}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {REPORT_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>
                      {t}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {multi && (
                <p className="text-[11px] text-muted-foreground">
                  per-identifier type is detected automatically in multi-select
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">Load ingested identifiers</Label>
              <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    role="combobox"
                    aria-expanded={pickerOpen}
                    className="w-full justify-between font-normal"
                    disabled={!identifiers.length}
                  >
                    <span className="truncate">{triggerLabel}</span>
                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[min(28rem,90vw)] p-0" align="start">
                  <div className="flex items-center justify-between border-b border-border px-3 py-2">
                    <span className="text-xs text-muted-foreground">
                      {selectedIds.length} selected
                    </span>
                    <div className="flex gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 text-xs"
                        onClick={() => setSelectedIds(identifiers.map((i) => i.id))}
                      >
                        Select all
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 text-xs"
                        onClick={clearSelection}
                      >
                        Clear
                      </Button>
                    </div>
                  </div>
                  <ScrollArea className="max-h-72">
                    <div className="p-1">
                      {identifiers.map((i) => {
                        const [type] = primaryGroup(i);
                        const checked = selectedIds.includes(i.id);
                        return (
                          <button
                            key={i.id}
                            type="button"
                            onClick={() => toggle(i.id)}
                            className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left hover:bg-accent"
                          >
                            <Checkbox checked={checked} className="pointer-events-none" />
                            <span className="min-w-0 flex-1 truncate font-mono text-xs">
                              {i.primary_identifier}
                            </span>
                            <Badge variant="secondary" className="text-[10px]">
                              {type}
                            </Badge>
                          </button>
                        );
                      })}
                    </div>
                  </ScrollArea>
                </PopoverContent>
              </Popover>

              {selected.length > 0 && (
                <div className="flex flex-wrap gap-1 pt-1">
                  {selected.map((s) => (
                    <Badge
                      key={s.id}
                      variant="outline"
                      className="max-w-[12rem] gap-1 font-mono text-[10px]"
                    >
                      <span className="truncate">{s.primary_identifier}</span>
                      <X
                        className="h-3 w-3 shrink-0 cursor-pointer opacity-60 hover:opacity-100"
                        onClick={() => toggle(s.id)}
                      />
                    </Badge>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Row (CSV header + one row, or a JSON object)</Label>
            <Textarea
              value={raw}
              onChange={(e) => {
                setRaw(e.target.value);
                setSelectedIds([]);
              }}
              rows={10}
              className="font-mono text-xs"
              disabled={multi}
            />
            {multi ? (
              <p className="text-xs text-muted-foreground">
                Editing is disabled while multiple identifiers are selected — each selected row
                is inspected with its own stored signals.
              </p>
            ) : (
              !row && (
                <p className="text-xs text-destructive">
                  Could not parse — provide a header line plus one data row, or a JSON object.
                </p>
              )
            )}
          </div>
        </div>

        <div className="space-y-5">
          {multi
            ? multiResults.map(({ rec, type, result }) => (
                <ResultBlock
                  key={rec.id}
                  result={result}
                  nodeIds={nodeIds}
                  storedWeights={
                    rec.audio_source_id ? weightsBySource[rec.audio_source_id] ?? {} : {}
                  }
                  heading={`${rec.primary_identifier} · ${type}`}
                />
              ))
            : singleResult && (
                <ResultBlock
                  result={singleResult}
                  nodeIds={nodeIds}
                  storedWeights={singleWeights}
                />
              )}

          {resolving && (
            <p className="flex items-center gap-1 text-xs text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" /> resolving taxonomy nodes…
            </p>
          )}
        </div>
      </div>
    </Card>
  );
};

export default InspectMappingPanel;
