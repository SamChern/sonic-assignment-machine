import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, Play, Terminal } from "lucide-react";
import { McpToolForm } from "@/components/admin/McpToolForm";
import { McpResultView } from "@/components/admin/McpResultView";
import type { McpTool } from "@/lib/intuiziMcp";

export const ToolRunnerPanel = ({
  toolNames,
  rawTool,
  setRawTool,
  setFormArgs,
  setRawArgs,
  setRawOut,
  setRawResult,
  runRaw,
  rawBusy,
  jsonMode,
  setJsonMode,
  formArgs,
  selectedToolDef,
  rawArgs,
  rawResult,
  rawOut,
  ingestKeys,
}: {
  toolNames: string[];
  rawTool: string;
  setRawTool: (v: string) => void;
  setFormArgs: (v: Record<string, unknown>) => void;
  setRawArgs: (v: string) => void;
  setRawOut: (v: string) => void;
  setRawResult: (v: unknown) => void;
  runRaw: () => void;
  rawBusy: boolean;
  jsonMode: boolean;
  setJsonMode: (fn: (v: boolean) => boolean) => void;
  formArgs: Record<string, unknown>;
  selectedToolDef: McpTool | undefined;
  rawArgs: string;
  rawResult: unknown;
  rawOut: string;
  ingestKeys: (k: string[]) => void;
}) => {
  return (
    <Collapsible>
      <CollapsibleTrigger className="flex w-full items-center gap-2 rounded-lg border border-border bg-card/60 p-2 text-xs font-medium">
        <Terminal className="h-3.5 w-3.5" /> Tool runner ({toolNames.length} tools)
      </CollapsibleTrigger>
      <CollapsibleContent className="mt-2 space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <Select
            value={rawTool}
            onValueChange={(v) => {
              setRawTool(v);
              setFormArgs({});
              setRawArgs("{}");
              setRawOut("");
              setRawResult(null);
            }}
          >
            <SelectTrigger className="h-9 w-[260px] text-xs">
              <SelectValue placeholder="Pick a tool" />
            </SelectTrigger>
            <SelectContent>
              {toolNames.map((n) => (
                <SelectItem key={n} value={n}>{n}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button size="sm" onClick={runRaw} disabled={!rawTool || rawBusy}>
            {rawBusy ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Play className="mr-1 h-4 w-4" />}
            Run
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="text-[11px]"
            onClick={() => {
              if (!jsonMode) setRawArgs(JSON.stringify(formArgs, null, 2));
              setJsonMode((v) => !v);
            }}
          >
            {jsonMode ? "Use form fields" : "Edit as JSON"}
          </Button>
        </div>

        {!!selectedToolDef?.description && (
          <p className="text-[11px] text-muted-foreground">{selectedToolDef.description}</p>
        )}

        {rawTool ? (
          jsonMode ? (
            <Textarea
              value={rawArgs}
              onChange={(e) => setRawArgs(e.target.value)}
              rows={6}
              spellCheck={false}
              className="font-mono text-[11px]"
            />
          ) : (
            <McpToolForm
              schema={selectedToolDef?.inputSchema}
              resetKey={rawTool}
              onChange={setFormArgs}
            />
          )
        ) : (
          <p className="text-[11px] text-muted-foreground">
            Pick a tool to get its native input fields.
          </p>
        )}

        {!jsonMode && !!rawTool && (
          <pre className="max-h-24 overflow-auto rounded bg-muted/20 p-2 text-[10px] text-muted-foreground">
            {JSON.stringify(formArgs, null, 2)}
          </pre>
        )}

        {!!rawResult && (
          <McpResultView
            result={rawResult}
            toolName={rawTool}
            onExportKeys={(k) => void ingestKeys(k)}
          />
        )}

        {!!rawOut && (
          <pre className="max-h-64 overflow-auto rounded bg-muted/30 p-2 text-[10px]">{rawOut}</pre>
        )}

      </CollapsibleContent>
    </Collapsible>
  );
};
