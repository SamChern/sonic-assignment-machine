import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Progress } from "@/components/ui/progress";
import { ChevronDown, Braces, Copy, Sparkles, Table2, Tags, Waves } from "lucide-react";
import { toast } from "sonner";
import { asText } from "@/lib/intuiziMcp";
import {
  SIGNAL_KIND_LABEL,
  buildInsight,
  type SignalKind,
} from "@/lib/mcpResultInsights";

interface Props {
  result: unknown;
  toolName?: string;
  /** Rendered under the headline, e.g. latency or resource id. */
  meta?: string;
  onExportKeys?: (keys: string[]) => void;
}

const KIND_ORDER: SignalKind[] = [
  "genre",
  "content-type",
  "channel",
  "app",
  "iab",
  "brand",
  "daypart",
  "geo",
  "device",
  "audience",
];

/**
 * Visual, non-JSON rendering of an Intuizi MCP tool result: what came back,
 * which taxonomy signals it carries, and how those map onto SonicSIM's six
 * semantic categories. Raw JSON stays one click away.
 */
export const McpResultView = ({ result, toolName, meta, onExportKeys }: Props) => {
  const insight = useMemo(() => buildInsight(result, toolName), [result, toolName]);
  const [showRaw, setShowRaw] = useState(false);
  const [showTable, setShowTable] = useState(false);

  const grouped = KIND_ORDER.map((kind) => ({
    kind,
    chips: insight.signals.filter((s) => s.kind === kind).slice(0, 14),
  })).filter((g) => g.chips.length);

  const tableCols = insight.columns.slice(0, 8);
  const activeBridges = insight.bridges.filter((b) => Math.abs(b.tilt) >= 0.5);

  return (
    <div className="space-y-3 rounded-lg border border-primary/20 bg-card/60 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Waves className="h-4 w-4 text-primary" />
        <span className="text-xs font-semibold">{insight.headline}</span>
        {!!meta && <Badge variant="outline" className="text-[10px]">{meta}</Badge>}
        <div className="ml-auto flex items-center gap-1">
          {!!insight.deliveryKeys.length && !!onExportKeys && (
            <Button
              size="sm"
              variant="secondary"
              className="h-7 text-[11px]"
              onClick={() => onExportKeys(insight.deliveryKeys)}
            >
              <Sparkles className="mr-1 h-3 w-3" />
              Ingest {insight.deliveryKeys.length} object(s)
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            className="h-7 text-[11px]"
            onClick={() => {
              void navigator.clipboard.writeText(asText(result));
              toast.success("Raw response copied");
            }}
          >
            <Copy className="h-3 w-3" />
          </Button>
        </div>
      </div>

      {!!insight.facts.length && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
          {insight.facts.map((f) => (
            <div key={f.label} className="rounded-md bg-background/60 px-2 py-1.5">
              <p className="truncate text-[9px] uppercase tracking-wide text-muted-foreground">{f.label}</p>
              <p className="truncate text-[11px] font-medium">{f.value}</p>
            </div>
          ))}
        </div>
      )}

      {!!grouped.length && (
        <div className="space-y-2">
          <div className="flex items-center gap-1.5">
            <Tags className="h-3.5 w-3.5 text-primary" />
            <span className="text-[11px] font-medium">Intuizi taxonomy signals</span>
          </div>
          {grouped.map((g) => (
            <div key={g.kind} className="flex flex-wrap items-center gap-1">
              <span className="w-full text-[9px] uppercase tracking-wide text-muted-foreground sm:w-auto sm:min-w-[112px]">
                {SIGNAL_KIND_LABEL[g.kind]}
              </span>
              {g.chips.map((c) => (
                <Badge key={`${c.kind}-${c.label}`} variant="outline" className="gap-1 text-[10px]">
                  {c.label}
                  {c.count > 1 && <span className="text-muted-foreground">×{c.count}</span>}
                </Badge>
              ))}
            </div>
          ))}
        </div>
      )}

      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <Sparkles className="h-3.5 w-3.5 text-primary" />
          <span className="text-[11px] font-medium">Semantic bridge to SonicSIM</span>
          <span className="text-[10px] text-muted-foreground">
            {activeBridges.length
              ? "preview only — real scores come from analysis after ingestion"
              : "no ontology-bearing signals in this response yet"}
          </span>
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          {insight.bridges.map((b) => (
            <div key={b.key} className="space-y-1">
              <div className="flex items-center justify-between gap-2 text-[10px]">
                <span className="flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full" style={{ background: b.color }} />
                  {b.name}
                </span>
                <span className={b.tilt > 0 ? "text-primary" : b.tilt < 0 ? "text-muted-foreground" : "text-muted-foreground"}>
                  {b.tilt > 0 ? "+" : ""}{b.tilt}
                </span>
              </div>
              <Progress value={b.score} className="h-1.5" />
              {!!b.drivers.length && (
                <p className="truncate text-[9px] text-muted-foreground">{b.drivers.join(" · ")}</p>
              )}
            </div>
          ))}
        </div>
        {!!insight.unmapped.length && (
          <p className="text-[10px] text-muted-foreground">
            Unmapped signals (no ontology rule yet): {insight.unmapped.join(", ")}
          </p>
        )}
      </div>

      {!!insight.records.length && !!tableCols.length && (
        <Collapsible open={showTable} onOpenChange={setShowTable}>
          <CollapsibleTrigger asChild>
            <Button variant="ghost" size="sm" className="h-7 text-[11px]">
              <Table2 className="mr-1 h-3 w-3" />
              Records ({insight.records.length})
              <ChevronDown className={`ml-1 h-3 w-3 transition-transform ${showTable ? "rotate-180" : ""}`} />
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="max-h-64 overflow-auto rounded-md border border-border/60">
              <table className="w-full text-[10px]">
                <thead className="sticky top-0 bg-muted/60">
                  <tr>
                    {tableCols.map((c) => (
                      <th key={c} className="whitespace-nowrap px-2 py-1 text-left font-medium">{c}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {insight.records.slice(0, 50).map((r, i) => (
                    <tr key={i} className="border-t border-border/40">
                      {tableCols.map((c) => (
                        <td key={c} className="max-w-[220px] truncate px-2 py-1">
                          {r[c] === null || r[c] === undefined ? "—" : String(r[c])}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CollapsibleContent>
        </Collapsible>
      )}

      <Collapsible open={showRaw} onOpenChange={setShowRaw}>
        <CollapsibleTrigger asChild>
          <Button variant="ghost" size="sm" className="h-7 text-[11px]">
            <Braces className="mr-1 h-3 w-3" />
            Raw JSON
            <ChevronDown className={`ml-1 h-3 w-3 transition-transform ${showRaw ? "rotate-180" : ""}`} />
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <pre className="max-h-64 overflow-auto rounded bg-muted/30 p-2 text-[10px]">
            {asText(result).slice(0, 12000)}
          </pre>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
};

export default McpResultView;
