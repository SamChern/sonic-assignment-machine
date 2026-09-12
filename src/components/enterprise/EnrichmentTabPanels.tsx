import { PanelErrorBoundary } from "@/components/PanelErrorBoundary";
import OwnDataScoringPanel from "@/components/enterprise/OwnDataScoringPanel";
import EnrichmentPreviewPanel from "@/components/enterprise/EnrichmentPreviewPanel";
import TagImpactPanel from "@/components/enterprise/TagImpactPanel";
import SignalExplorerPanel from "@/components/enterprise/SignalExplorerPanel";
import { useAuth } from "@/hooks/useAuth";

/**
 * The Enrichment tab: first what the account's own rows say (their numbers),
 * then what a shared feed adds on top.
 */
export default function EnrichmentTabPanels({
  organizationId,
  canWrite,
  refreshKey,
}: {
  organizationId: string;
  canWrite: boolean;
  refreshKey: number;
}) {
  return (
    <>
      <PanelErrorBoundary label="Your own data">
        <OwnDataScoringPanel
          key={`own-${refreshKey}-${organizationId}`}
          organizationId={organizationId}
          canWrite={canWrite}
        />
      </PanelErrorBoundary>
      <PanelErrorBoundary label="Predicted impact on your site tags">
        <TagImpactPanel
          key={`impact-${refreshKey}-${organizationId}`}
          organizationId={organizationId}
        />
      </PanelErrorBoundary>
      <PanelErrorBoundary label="Enrichment">
        <EnrichmentPreviewPanel
          key={`${refreshKey}-${organizationId}`}
          organizationId={organizationId}
        />
      </PanelErrorBoundary>
    </>
  );
}
