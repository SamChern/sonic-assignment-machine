import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Activity,
  AlertTriangle,
  Gauge,
  Loader2,
  Network,
  RefreshCw,
} from "lucide-react";
import { BrowseTab } from "@/components/admin/intuizi/BrowseTab";
import { DeliveredObjectsPanel } from "@/components/admin/intuizi/DeliveredObjectsPanel";
import { ReferenceCatalogPanel } from "@/components/admin/intuizi/ReferenceCatalogPanel";
import { GuidedAudienceBuild } from "@/components/admin/intuizi/GuidedAudienceBuild";
import { ToolRunnerPanel } from "@/components/admin/intuizi/ToolRunnerPanel";
import { ConfirmWriteDialog } from "@/components/admin/intuizi/ConfirmWriteDialog";
import { useIntuiziConsole } from "@/components/admin/intuizi/useIntuiziConsole";

/**
 * Admin cockpit for the Intuizi console over MCP. Reads are one click; every
 * mutating tool routes through a confirm dialog and the backend write toggle.
 * Delivery keys hand off to the existing intuizi-ingest pipeline untouched.
 */
export const IntuiziConsolePanel = () => {
  const c = useIntuiziConsole();

  return (
    <Card className="p-5 space-y-5 border-primary/20 bg-gradient-to-b from-primary/5 to-transparent">
      <div className="flex flex-wrap items-center gap-2">
        <Network className="h-5 w-5 text-primary" />
        <h2 className="text-base font-semibold">Intuizi Console (MCP)</h2>
        {c.connecting ? (
          <Badge variant="outline" className="gap-1 text-[11px]">
            <Loader2 className="h-3 w-3 animate-spin" /> connecting
          </Badge>
        ) : c.connError ? (
          <Badge variant="destructive" className="text-[11px]">not connected</Badge>
        ) : !c.tools.length ? (
          <Badge variant="outline" className="text-[11px]">idle — hit Connect</Badge>
        ) : (
          <Badge variant="outline" className="text-[11px] text-primary">
            {c.tools.length} tools
          </Badge>
        )}
        {!c.connecting && !c.connError && !!c.tools.length && (
          <Badge variant={c.writeEnabled ? "default" : "outline"} className="text-[11px]">
            {c.writeEnabled ? "writes enabled" : "read-only"}
          </Badge>
        )}
        <div className="ml-auto flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={c.loadUsage}
            disabled={!!c.connError || c.connecting || !c.tools.length}
          >
            <Gauge className="mr-1 h-4 w-4" /> Usage
          </Button>
          <Button variant="outline" size="sm" onClick={c.connect} disabled={c.connecting}>
            <RefreshCw className="mr-1 h-4 w-4" /> {c.tools.length ? "Reconnect" : "Connect"}
          </Button>
        </div>
      </div>

      {c.connError && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-xs">
          <p className="flex items-center gap-2 font-medium text-destructive">
            <AlertTriangle className="h-3.5 w-3.5" /> {c.connError}
          </p>
          <p className="mt-1 text-muted-foreground">
            Paste an MCP token in the “Intuizi Console MCP” card above (Intuizi console → My Account →
            MCP Tokens), then hit Reconnect.
          </p>
        </div>
      )}

      {c.usage && (
        <div className="rounded-lg border border-border bg-muted/20 p-3 text-[11px] font-mono break-all">
          {JSON.stringify(c.usage).slice(0, 600)}
        </div>
      )}

      {!c.connError && !c.connecting && !c.tools.length && (
        <p className="text-xs text-muted-foreground">
          Not connected yet. Save an Intuizi MCP token in the “Intuizi Console MCP” card above, then
          hit Connect to load the console tools.
        </p>
      )}

      {!c.connError && !c.connecting && !!c.tools.length && (
        <>
          <BrowseTab
            kind={c.kind}
            setKind={c.setKind}
            search={c.search}
            setSearch={c.setSearch}
            browse={c.browse}
            listing={c.listing}
            listRows={c.listRows}
            lookupId={c.lookupId}
            setLookupId={c.setLookupId}
            lookupById={c.lookupById}
            detailLoading={c.detailLoading}
            openDetail={c.openDetail}
            exportAudienceToApp={c.exportAudienceToApp}
            exportToApp={c.exportToApp}
            exportingId={c.exportingId}
            listResult={c.listResult}
            ingestKeys={c.ingestKeys}
            detail={c.detail}
            requestActivation={c.requestActivation}
            writeEnabled={c.writeEnabled}
            keys={c.keys}
          />

          {/* Delivery handoff into the untouched ingest pipeline */}
          <DeliveredObjectsPanel keys={c.keys} ingesting={c.ingesting} onIngest={c.ingestDelivered} />

          {/* Reference catalogs — nested per the Intuizi taxonomy */}
          <ReferenceCatalogPanel
            refDataset={c.refDataset}
            setRefDataset={c.setRefDataset}
            refCatalog={c.refCatalog}
            setRefCatalog={c.setRefCatalog}
            refTree={c.refTree}
            setRefTree={c.setRefTree}
            refRaw={c.refRaw}
            refBusy={c.refBusy}
            refError={c.refError}
            setRefError={c.setRefError}
            loadReference={c.loadReference}
          />

          {/* Guided build */}
          <GuidedAudienceBuild
            audienceBody={c.audienceBody}
            setAudienceBody={c.setAudienceBody}
            flowBusy={c.flowBusy}
            flowLog={c.flowLog}
            writeEnabled={c.writeEnabled}
            runEstimate={c.runEstimate}
            requestCreateAudience={c.requestCreateAudience}
          />

          {/* Tool runner — native fields generated from each tool's schema */}
          <ToolRunnerPanel
            toolNames={c.toolNames}
            rawTool={c.rawTool}
            setRawTool={c.setRawTool}
            setFormArgs={c.setFormArgs}
            setRawArgs={c.setRawArgs}
            setRawOut={c.setRawOut}
            setRawResult={c.setRawResult}
            runRaw={c.runRaw}
            rawBusy={c.rawBusy}
            jsonMode={c.jsonMode}
            setJsonMode={c.setJsonMode}
            formArgs={c.formArgs}
            selectedToolDef={c.selectedToolDef}
            rawArgs={c.rawArgs}
            rawResult={c.rawResult}
            rawOut={c.rawOut}
            ingestKeys={c.ingestKeys}
          />
        </>
      )}

      <ConfirmWriteDialog
        pending={c.pending}
        onOpenChange={(o) => !o && c.setPending(null)}
        onConfirm={c.confirmPending}
      />
    </Card>
  );
};

export default IntuiziConsolePanel;
