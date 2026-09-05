import { Card } from "@/components/ui/card";
import { Network } from "lucide-react";
import { NetworkVisualization } from "@/components/NetworkVisualization";
import { AnalysisResults } from "@/components/AnalysisResults";

interface AnalysisTabProps {
  analysisResults: { sources: any[]; images: any[] } | null;
}

/** "Analysis" tab — cross-user ontological network from an ad-hoc analysis run. */
export function AnalysisTab({ analysisResults }: AnalysisTabProps) {
  if (!analysisResults) {
    return (
      <Card className="p-8 text-center">
        <Network className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
        <p className="text-lg text-muted-foreground">
          Select sources from multiple users and click "Analyze" to compare ontological networks
        </p>
      </Card>
    );
  }

  return (
    <>
      <Card className="p-6 bg-card/80">
        <h3 className="text-lg font-semibold mb-4">Cross-User Ontological Network</h3>
        <NetworkVisualization
          sources={analysisResults.sources}
          sourceImages={analysisResults.images}
        />
      </Card>

      <Card className="p-6 bg-card/80">
        <h3 className="text-lg font-semibold mb-4">Detailed Analysis</h3>
        <AnalysisResults
          results={analysisResults.sources}
          isAnalyzing={false}
          sourceImages={analysisResults.images}
        />
      </Card>
    </>
  );
}
