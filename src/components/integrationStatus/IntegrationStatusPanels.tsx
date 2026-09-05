/**
 * Secondary navigation links and diagnostic panels shown below the stage
 * timeline on the Intuizi Console page.
 */
import { CheckCircle2, Radio } from "lucide-react";
import { Button } from "@/components/ui/button";
import IngestDebugPanel from "@/components/IngestDebugPanel";
import WorkerHealthCard from "@/components/admin/WorkerHealthCard";
import IngestByKeyPanel from "@/components/IngestByKeyPanel";
import EnrichmentReadinessPanel from "@/components/EnrichmentReadinessPanel";
import AudioSetCrosswalkPanel from "@/components/admin/AudioSetCrosswalkPanel";

interface IntegrationStatusPanelsProps {
  onNavigateCompatibility: () => void;
  onNavigateSemantic: () => void;
}

const IntegrationStatusPanels = ({
  onNavigateCompatibility,
  onNavigateSemantic,
}: IntegrationStatusPanelsProps) => {
  return (
    <>
      <div className="mt-6 flex flex-wrap justify-end gap-2">
        <Button variant="outline" size="sm" onClick={onNavigateCompatibility}>
          <CheckCircle2 className="mr-1 h-4 w-4" />
          Ingestion compatibility tests
        </Button>
        <Button variant="outline" size="sm" onClick={onNavigateSemantic}>
          <Radio className="mr-1 h-4 w-4" />
          SonicSIM Analysis Results
        </Button>
      </div>

      <div className="mt-6 space-y-4">
        <IngestByKeyPanel />
        <AudioSetCrosswalkPanel />
        <EnrichmentReadinessPanel />

        <WorkerHealthCard />
        <IngestDebugPanel />
      </div>
    </>
  );
};

export default IntegrationStatusPanels;
