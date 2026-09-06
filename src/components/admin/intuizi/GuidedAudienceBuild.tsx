import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { ChevronDown, Loader2, ShieldAlert } from "lucide-react";

export const GuidedAudienceBuild = ({
  audienceBody,
  setAudienceBody,
  flowBusy,
  flowLog,
  writeEnabled,
  runEstimate,
  requestCreateAudience,
}: {
  audienceBody: string;
  setAudienceBody: (v: string) => void;
  flowBusy: boolean;
  flowLog: string[];
  writeEnabled: boolean;
  runEstimate: () => void;
  requestCreateAudience: () => void;
}) => {
  return (
    <Collapsible>
      <CollapsibleTrigger className="flex w-full items-center gap-2 rounded-lg border border-border bg-card/60 p-2 text-xs font-medium">
        <ChevronDown className="h-3.5 w-3.5" /> Guided audience build (estimate → create → poll → activate)
      </CollapsibleTrigger>
      <CollapsibleContent className="mt-2 space-y-2">
        <Textarea
          value={audienceBody}
          onChange={(e) => setAudienceBody(e.target.value)}
          rows={8}
          spellCheck={false}
          className="font-mono text-[11px]"
        />
        <p className="text-[11px] text-muted-foreground">
          Body follows the documented `create_audience` contract — the same JSON is used for the
          read-only estimate. A `WebDomain` block's `start_date` is limited to the last 45 days.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" size="sm" onClick={runEstimate} disabled={flowBusy}>
            {flowBusy ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}
            Estimate size (read-only)
          </Button>
          <Button size="sm" onClick={requestCreateAudience} disabled={flowBusy || !writeEnabled}>
            Create audience…
          </Button>
          {!writeEnabled && (
            <span className="flex items-center gap-1 text-[11px] text-amber-500">
              <ShieldAlert className="h-3 w-3" /> enable the write capability to create
            </span>
          )}
        </div>
        {!!flowLog.length && (
          <pre className="max-h-48 overflow-auto rounded bg-muted/30 p-2 text-[10px]">
            {flowLog.join("\n")}
          </pre>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
};
