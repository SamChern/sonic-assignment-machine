import { useEffect, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { useUiPreferenceValue } from "@/hooks/useUiPreference";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/use-toast";

import { Loader2 } from "lucide-react";
import { fetchIntegrationStatus, type IngestState } from "@/lib/integrationStatusData";
import { type Stage } from "./integrationStatus/stageModel";
import IntegrationStatusHeader from "@/components/integrationStatus/IntegrationStatusHeader";
import StageTimeline from "@/components/integrationStatus/StageTimeline";
import IntegrationStatusPanels from "@/components/integrationStatus/IntegrationStatusPanels";


const IntegrationStatus = () => {
  const { user, isAdmin, loading } = useAuth();
  const navigate = useNavigate();
  const [stages, setStages] = useState<Stage[]>([]);
  const [refreshing, setRefreshing] = useState(true);
  const [fetchedAt, setFetchedAt] = useState<Date | null>(null);
  const [expandedStages, setExpandedStages] = useState<Record<string, boolean>>({});
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [ingestState, setIngestState] = useState<IngestState | null>(null);
  const [running, setRunning] = useState(false);

  // Collapse/expand choices ride on the unified preference store, so the shape
  // of this page follows the operator across devices.
  const [stagePrefs, setStagePrefs] = useUiPreferenceValue<Record<string, boolean>>(
    "pipeline.expandedStages",
    {},
    (v) => !!v && typeof v === "object" && !Array.isArray(v),
  );

  useEffect(() => {
    if (Object.keys(stagePrefs).length) setExpandedStages(stagePrefs);
  }, [stagePrefs]);

  const persistStages = useCallback(
    (next: Record<string, boolean>) => setStagePrefs(next),
    [setStagePrefs],
  );

  const toggle = (key: string) =>
    setExpanded((prev) => ({ ...prev, [key]: !prev[key] }));

  const toggleStage = (key: string) =>
    setExpandedStages((prev) => {
      const next = { ...prev, [key]: !prev[key] };
      persistStages(next);
      return next;
    });

  const setAllStages = (open: boolean) => {
    const next: Record<string, boolean> = {};
    stages.forEach((s) => {
      next[s.key] = open;
    });
    setExpandedStages(next);
    persistStages(next);
  };


  useEffect(() => {
    if (!loading) {
      if (!user) navigate("/auth");
      else if (!isAdmin) navigate("/");
    }
  }, [loading, user, isAdmin, navigate]);

  const load = useCallback(async () => {
    setRefreshing(true);
    const { stages: next, ingestState: ingestStateRow } = await fetchIntegrationStatus();
    setIngestState(ingestStateRow);
    setStages(next);
    setFetchedAt(new Date());
    setRefreshing(false);
  }, []);

  useEffect(() => {
    if (isAdmin) load();
  }, [isAdmin, load]);

  const invokeIngest = useCallback(
    async (action: "run_now" | "resume") => {
      setRunning(true);
      try {
        const { data, error } = await supabase.functions.invoke("intuizi-ingest", {
          body: { action },
        });
        if (error) {
          const details =
            "context" in error && error.context
              ? await (error.context as Response).text().catch(() => error.message)
              : error.message;
          toast({ title: "Ingest run failed", description: details, variant: "destructive" });
        } else if (data?.error) {
          toast({ title: "Ingest blocked", description: String(data.error), variant: "destructive" });
        } else if (action === "resume") {
          toast({ title: "Ingest resumed", description: "The next run will process a full batch." });
        } else {
          toast({
            title: data?.idle ? "Nothing new to ingest" : "Ingest run complete",
            description: data?.idle
              ? "No unprocessed objects found in the inbound bucket."
              : `${data?.files_processed ?? 0} object(s), ${data?.identifiers_scored ?? 0} identifier(s) scored.`,
          });
        }
      } finally {
        setRunning(false);
        load();
      }
    },
    [load],
  );

  if (loading || !isAdmin) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <IntegrationStatusHeader
        ingestState={ingestState}
        running={running}
        refreshing={refreshing}
        fetchedAt={fetchedAt}
        onBack={() => navigate("/admin")}
        onInvokeIngest={invokeIngest}
        onRefresh={load}
      />

      <main className="container mx-auto px-4 sm:px-6 py-6 sm:py-8 max-w-4xl space-y-4">
        <p className="text-sm text-muted-foreground">
          End-to-end pipeline health from the Intuizi console through to outbound
          segment activation. Your expand/collapse choices are saved for next
          time.
        </p>

        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setAllStages(true)} disabled={!stages.length}>
            Expand all
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setAllStages(false)} disabled={!stages.length}>
            Collapse all
          </Button>
        </div>

        <StageTimeline
          stages={stages}
          expandedStages={expandedStages}
          expanded={expanded}
          onToggleStage={toggleStage}
          onToggleDetails={toggle}
        />

        <IntegrationStatusPanels
          onNavigateCompatibility={() => navigate("/admin/compatibility")}
          onNavigateSemantic={() => navigate("/admin/semantic")}
        />
      </main>

    </div>
  );
};

export default IntegrationStatus;
