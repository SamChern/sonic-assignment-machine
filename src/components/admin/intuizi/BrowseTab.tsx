import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Activity, Loader2, Sparkles } from "lucide-react";
import { McpResultView } from "@/components/admin/McpResultView";
import {
  AUDIENCE_COMPLETED,
  statusId,
  statusLabel,
  type EnvelopeRow,
} from "@/lib/intuiziMcp";
import { ActivationLauncher } from "./ActivationLauncher";
import { BROWSE_TOOL, type BrowseKind } from "./types";

export const BrowseTab = ({
  kind,
  setKind,
  search,
  setSearch,
  browse,
  listing,
  listRows,
  lookupId,
  setLookupId,
  lookupById,
  detailLoading,
  openDetail,
  exportAudienceToApp,
  exportToApp,
  exportingId,
  listResult,
  ingestKeys,
  detail,
  requestActivation,
  writeEnabled,
  keys,
}: {
  kind: BrowseKind;
  setKind: (v: BrowseKind) => void;
  search: string;
  setSearch: (v: string) => void;
  browse: () => void;
  listing: boolean;
  listRows: EnvelopeRow[];
  lookupId: string;
  setLookupId: (v: string) => void;
  lookupById: () => void;
  detailLoading: boolean;
  openDetail: (row: EnvelopeRow) => void;
  exportAudienceToApp: (id: string) => void;
  exportToApp: (id: string, knownKeys?: string[]) => void;
  exportingId: string | null;
  listResult: unknown;
  ingestKeys: (k: string[]) => void;
  detail: { kind: BrowseKind; row: EnvelopeRow; raw: unknown } | null;
  requestActivation: (audienceId: string, endpointId: string) => void;
  writeEnabled: boolean;
  keys: string[];
}) => {
  return (
    <Tabs value={kind} onValueChange={(v) => setKind(v as BrowseKind)}>
      <TabsList className="grid w-full grid-cols-4">
        <TabsTrigger value="audiences" className="text-xs">Audiences</TabsTrigger>
        <TabsTrigger value="activations" className="text-xs">Activations</TabsTrigger>
        <TabsTrigger value="cohorts" className="text-xs">Cohorts</TabsTrigger>
        <TabsTrigger value="projects" className="text-xs">Projects</TabsTrigger>
      </TabsList>
      <TabsContent value={kind} className="mt-3 space-y-3">
        <div className="flex gap-2">
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void browse()}
            placeholder={`Search ${kind}…`}
            className="h-9 text-xs"
          />
          <Button size="sm" onClick={browse} disabled={listing}>
            {listing ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Activity className="mr-1 h-4 w-4" />}
            {listRows.length ? "Refresh" : "Load"}
          </Button>
        </div>

        {kind !== "projects" && (
          <div className="flex gap-2">
            <Input
              value={lookupId}
              onChange={(e) => setLookupId(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void lookupById()}
              placeholder={`Open ${kind.slice(0, -1)} by id (e.g. 5514)`}
              className="h-9 font-mono text-xs"
            />
            <Button
              size="sm"
              variant="outline"
              onClick={lookupById}
              disabled={detailLoading || !lookupId.trim()}
            >
              Open
            </Button>
          </div>
        )}

        <div className="space-y-1">
          {listRows.map((row) => (
            <div
              key={String(row.id)}
              className="flex items-center gap-2 rounded-lg border border-border/60 bg-card/60 p-2 transition-colors hover:border-primary/50"
            >
              <button
                onClick={() => void openDetail(row)}
                className="min-w-0 flex-1 text-left"
              >
                <div className="flex items-baseline justify-between gap-2">
                  <span className="truncate text-xs font-medium">{row.name ?? `#${row.id}`}</span>
                  <span className="shrink-0 text-[11px] text-muted-foreground">{statusLabel(row)}</span>
                </div>
                <span className="font-mono text-[10px] text-muted-foreground">
                  id {String(row.id)}
                  {row.created_at ? ` · ${new Date(String(row.created_at)).toLocaleDateString()}` : ""}
                </span>
              </button>
              {kind === "audiences" && row.id != null && (
                <Button
                  size="sm"
                  variant="secondary"
                  className="shrink-0 text-[11px]"
                  onClick={() => void exportAudienceToApp(String(row.id))}
                  disabled={exportingId !== null}
                >
                  {exportingId === `aud:${String(row.id)}` ? (
                    <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                  ) : (
                    <Sparkles className="mr-1 h-3 w-3" />
                  )}
                  Add to semantic analysis
                </Button>
              )}
              {kind === "activations" && row.id != null && (
                <Button
                  size="sm"
                  variant="secondary"
                  className="shrink-0 text-[11px]"
                  onClick={() => void exportToApp(String(row.id))}
                  disabled={exportingId !== null}
                >
                  {exportingId === String(row.id) ? (
                    <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                  ) : (
                    <Sparkles className="mr-1 h-3 w-3" />
                  )}
                  Export
                </Button>
              )}


            </div>
          ))}

          {!listRows.length && !listing && (
            <p className="text-[11px] text-muted-foreground">
              Nothing loaded yet — hit Load to pull the {kind} already in your Intuizi console,
              or open one directly by id.
            </p>
          )}
        </div>

        {!!listResult && !!listRows.length && (
          <McpResultView
            result={listResult}
            toolName={BROWSE_TOOL[kind]}
            onExportKeys={(k) => void ingestKeys(k)}
          />
        )}

        {detailLoading && <Loader2 className="h-4 w-4 animate-spin text-primary" />}

        {detail && (
          <div className="rounded-lg border border-primary/30 bg-primary/5 p-3 space-y-2">
            <p className="text-xs font-medium">
              {detail.row.name ?? `#${detail.row.id}`} · {statusLabel(detail.row)}
            </p>
            {!!detail.row.eligibility && (
              <pre className="max-h-40 overflow-auto rounded bg-background/60 p-2 text-[10px]">
                {JSON.stringify(detail.row.eligibility, null, 2)}
              </pre>
            )}
            {!!detail.row.totals && (
              <pre className="max-h-32 overflow-auto rounded bg-background/60 p-2 text-[10px]">
                {JSON.stringify(detail.row.totals, null, 2)}
              </pre>
            )}
            {detail.kind === "audiences" && statusId(detail.row) === AUDIENCE_COMPLETED && (
              <ActivationLauncher
                disabled={!writeEnabled}
                onActivate={(endpointId) => requestActivation(String(detail.row.id), endpointId)}
              />
            )}
            {detail.kind === "audiences" && detail.row.id != null && (
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  size="sm"
                  onClick={() => void exportAudienceToApp(String(detail.row.id))}
                  disabled={exportingId !== null}
                >
                  {exportingId === `aud:${String(detail.row.id)}` ? (
                    <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                  ) : (
                    <Sparkles className="mr-1 h-4 w-4" />
                  )}
                  Add to semantic analysis
                </Button>
                <span className="text-[11px] text-muted-foreground">
                  Finds this audience's S3 deliveries, ingests them, then opens semantic analysis.
                </span>
              </div>
            )}

            {detail.kind === "activations" && detail.row.id != null && (
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  size="sm"
                  onClick={() => void exportToApp(String(detail.row.id), keys)}
                  disabled={exportingId !== null}
                >
                  {exportingId === String(detail.row.id) ? (
                    <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                  ) : (
                    <Sparkles className="mr-1 h-4 w-4" />
                  )}
                  Export to app for semantic analysis
                </Button>
                <span className="text-[11px] text-muted-foreground">
                  Ingests delivered objects, then opens semantic analysis scoped to this activation.
                </span>
              </div>
            )}

            <McpResultView
              result={detail.raw}
              toolName={`get_${detail.kind}`}
              onExportKeys={(k) => void ingestKeys(k)}
            />
          </div>
        )}
      </TabsContent>
    </Tabs>
  );
};
