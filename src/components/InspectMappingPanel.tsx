import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, Microscope, RefreshCw } from "lucide-react";
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

const InspectMappingPanel = () => {
  const [reportType, setReportType] = useState<ReportType>("ctv");
  const [raw, setRaw] = useState(SAMPLE.ctv);
  const [nodeIds, setNodeIds] = useState<Record<string, string>>({});
  const [storedWeights, setStoredWeights] = useState<Record<string, number>>({});
  const [identifiers, setIdentifiers] = useState<StoredIdentifier[]>([]);
  const [selectedId, setSelectedId] = useState<string>("");
  const [resolving, setResolving] = useState(false);

  const row = useMemo(() => parseRowInput(raw), [raw]);
  const result = useMemo(
    () => (row ? inspectRow(reportType, row) : null),
    [row, reportType],
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
    if (!result?.tags.length) {
      setNodeIds({});
      setStoredWeights({});
      return;
    }
    setResolving(true);
    const codes = result.tags.map((t) => t.code);
    const { data: nodes } = await supabase
      .from("taxonomy_nodes")
      .select("id, code")
      .in("code", codes);
    const map: Record<string, string> = {};
    for (const n of nodes ?? []) map[n.code as string] = n.id as string;
    setNodeIds(map);

    const stored = identifiers.find((i) => i.id === selectedId);
    if (stored?.audio_source_id && nodes?.length) {
      const { data: links } = await supabase
        .from("audio_source_tags")
        .select("node_id, weight")
        .eq("audio_source_id", stored.audio_source_id)
        .in("node_id", nodes.map((n) => n.id as string));
      const byCode: Record<string, number> = {};
      for (const l of links ?? []) {
        const code = Object.keys(map).find((c) => map[c] === l.node_id);
        if (code) byCode[code] = Number(l.weight);
      }
      setStoredWeights(byCode);
    } else {
      setStoredWeights({});
    }
    setResolving(false);
  }, [result, identifiers, selectedId]);

  useEffect(() => {
    resolveNodes();
  }, [resolveNodes]);

  const pickStored = (id: string) => {
    setSelectedId(id);
    const rec = identifiers.find((i) => i.id === id);
    if (!rec) return;
    const groups: [ReportType, Record<string, unknown> | null][] = [
      ["ctv", rec.ctv_signals],
      ["apps", rec.apps_signals],
      ["visitation", rec.visitation_signals],
      ["demographics", rec.demographics_signals],
      ["origin", rec.origin_signals],
    ];
    const hit = groups.find(([, v]) => v && Object.keys(v).length > 0);
    const type = hit?.[0] ?? "ctv";
    setReportType(type);
    setRaw(
      JSON.stringify(
        { primary_identifier: rec.primary_identifier, ...flattenSignals(hit?.[1] ?? null) },
        null,
        2,
      ),
    );
  };

  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Microscope className="h-4 w-4 text-primary" />
        <h2 className="text-sm font-semibold">Inspect mapping</h2>
        <p className="text-xs text-muted-foreground">
          field → taxonomy node → tag weight
        </p>
        <Button
          variant="ghost"
          size="sm"
          className="ml-auto"
          onClick={loadIdentifiers}
        >
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
                  setSelectedId("");
                  setRaw(SAMPLE[t]);
                }}
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
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Load ingested identifier</Label>
              <Select value={selectedId} onValueChange={pickStored}>
                <SelectTrigger>
                  <SelectValue
                    placeholder={
                      identifiers.length ? "Pick one…" : "none ingested yet"
                    }
                  />
                </SelectTrigger>
                <SelectContent>
                  {identifiers.map((i) => (
                    <SelectItem key={i.id} value={i.id}>
                      {i.primary_identifier}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">
              Row (CSV header + one row, or a JSON object)
            </Label>
            <Textarea
              value={raw}
              onChange={(e) => {
                setRaw(e.target.value);
                setSelectedId("");
              }}
              rows={10}
              className="font-mono text-xs"
            />
            {!row && (
              <p className="text-xs text-destructive">
                Could not parse — provide a header line plus one data row, or a JSON object.
              </p>
            )}
          </div>
        </div>

        <div className="space-y-3">
          {result && (
            <>
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
                {result.skippedReason && (
                  <p className="text-destructive">{result.skippedReason}</p>
                )}
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="text-muted-foreground">
                    <tr className="border-b border-border">
                      <th className="py-1.5 pr-2 text-left font-medium">Field</th>
                      <th className="py-1.5 pr-2 text-left font-medium">Value</th>
                      <th className="py-1.5 pr-2 text-left font-medium">
                        Taxonomy node(s)
                      </th>
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
                                  <p className="text-[11px] text-muted-foreground">
                                    parent {t.parent_code} ·{" "}
                                    {nodeIds[t.code] ? (
                                      <Badge
                                        variant="outline"
                                        className="text-[10px] py-0"
                                      >
                                        existing node
                                      </Badge>
                                    ) : (
                                      <Badge
                                        variant="secondary"
                                        className="text-[10px] py-0"
                                      >
                                        will be created
                                      </Badge>
                                    )}
                                  </p>
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
                                    <span className="text-[11px] text-muted-foreground">
                                      {" "}
                                      stored
                                    </span>
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

              {resolving && (
                <p className="flex items-center gap-1 text-xs text-muted-foreground">
                  <Loader2 className="h-3 w-3 animate-spin" /> resolving taxonomy nodes…
                </p>
              )}
            </>
          )}
        </div>
      </div>
    </Card>
  );
};

export default InspectMappingPanel;
