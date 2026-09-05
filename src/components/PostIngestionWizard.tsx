import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import InferenceConfigGuard from "@/components/InferenceConfigGuard";
import PhaseCpuChart from "@/components/PhaseCpuChart";
import ScoreQueueHealthPanel from "@/components/ScoreQueueHealthPanel";
import { useInferenceReadiness } from "@/hooks/useInferenceReadiness";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, Play, RefreshCw, Search, Wand2 } from "lucide-react";

import DeadlinePanel from "@/components/wizard/DeadlinePanel";
import LiveRunBanner from "@/components/wizard/LiveRunBanner";
import ResumeForecastPanel from "@/components/wizard/ResumeForecastPanel";
import StageList from "@/components/wizard/StageList";
import { useWizardEngine } from "@/components/wizard/useWizardEngine";

const PostIngestionWizard = () => {
  const {
    activations,
    selected,
    setSelected,
    discovering,
    running,
    expandedStages,
    setExpandedStages,
    partialFiles,
    resumeEstimates,
    deadlines,
    phaseRuns,
    setPhaseRuns,
    liveRun,
    activation,
    results,
    setResults,
    discover,
    run,
    resume,
  } = useWizardEngine();

  const {
    readiness,
    loading: inferenceLoading,
    error: inferenceError,
    blocked: inferenceBlocked,
    recheck,
  } = useInferenceReadiness();

  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-center gap-2">
        <Wand2 className="h-5 w-5 text-primary" />
        <h2 className="text-base font-semibold">Guided data stream wizard</h2>
        <Badge variant="outline" className="text-[11px]">admin only</Badge>
        <Button
          variant="outline"
          size="sm"
          className="ml-auto"
          onClick={discover}
          disabled={discovering || running}
        >
          {discovering ? (
            <Loader2 className="mr-1 h-4 w-4 animate-spin" />
          ) : (
            <Search className="mr-1 h-4 w-4" />
          )}
          {activations.length ? "Rescan bucket" : "Find activations"}
        </Button>
      </div>

      <p className="mt-2 text-xs text-muted-foreground">
        Pick an Intuizi activation id, then run the semantic stages in order: ingest and normalize the
        delivery, build the activation profile with taxonomy tags, score it through the ontology, and
        join the device roster.
      </p>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Select value={selected} onValueChange={setSelected} disabled={!activations.length || running}>
          <SelectTrigger className="w-full max-w-md">
            <SelectValue placeholder={activations.length ? "Select an activation id" : "Scan the bucket first"} />
          </SelectTrigger>
          <SelectContent>
            {activations.map((a) => (
              <SelectItem key={a.activation_id} value={a.activation_id}>
                {a.activation_id === "unassigned" ? "Unassigned files" : `Activation ${a.activation_id}`}
                {" · "}
                {a.files.length} file{a.files.length === 1 ? "" : "s"}
                {a.empty_files ? ` · ${a.empty_files} empty` : ""}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Button onClick={run} disabled={!activation || running || inferenceBlocked}>
          {running ? (
            <Loader2 className="mr-1 h-4 w-4 animate-spin" />
          ) : (
            <Play className="mr-1 h-4 w-4" />
          )}
          Run semantic processing
        </Button>

        {!running && !!Object.keys(results).length && (
          partialFiles.length ? (
            <>
              <Badge variant="outline" className="border-amber-500/50 text-amber-600 dark:text-amber-400">
                Partial · {partialFiles.length} file{partialFiles.length === 1 ? "" : "s"} left
              </Badge>
              <Button onClick={resume} disabled={inferenceBlocked} variant="secondary">
                <Play className="mr-1 h-4 w-4" />
                Resume ingestion
              </Button>
            </>
          ) : (
            <Badge variant="outline" className="border-emerald-500/50 text-emerald-600 dark:text-emerald-400">
              Complete
            </Badge>
          )
        )}

        {liveRun && <LiveRunBanner liveRun={liveRun} />}

        {!running && !!deadlines.length && <DeadlinePanel deadlines={deadlines} />}

        {!running && !!phaseRuns.length && (
          <div className="w-full space-y-1">
            <PhaseCpuChart runs={phaseRuns} />
            <div className="flex justify-end">
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-2 text-[10px] text-muted-foreground"
                onClick={() => setPhaseRuns([])}
              >
                Clear phase history
              </Button>
            </div>
          </div>
        )}

        {/* Dead-letter visibility + one-click recovery for the background scorer. */}
        <div className="mt-4 w-full">
          <ScoreQueueHealthPanel activationId={selected || undefined} />
        </div>

        {!running && !!resumeEstimates.length && (
          <ResumeForecastPanel resumeEstimates={resumeEstimates} />
        )}

        {!!Object.keys(results).length && !running && (
          <Button variant="ghost" size="sm" onClick={() => setResults({})}>
            <RefreshCw className="mr-1 h-4 w-4" />
            Clear
          </Button>
        )}
      </div>

      <div className="mt-3">
        <InferenceConfigGuard
          readiness={readiness}
          loading={inferenceLoading}
          error={inferenceError}
          onRecheck={recheck}
        />
      </div>

      <StageList
        results={results}
        expandedStages={expandedStages}
        setExpandedStages={setExpandedStages}
      />
    </Card>
  );
};

export default PostIngestionWizard;
