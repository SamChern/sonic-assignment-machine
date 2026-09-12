import { PanelErrorBoundary } from "@/components/PanelErrorBoundary";
import OwnDataScoringPanel from "@/components/enterprise/OwnDataScoringPanel";
import EnrichmentPreviewPanel from "@/components/enterprise/EnrichmentPreviewPanel";

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
      <PanelErrorBoundary label="Enrichment">
        <EnrichmentPreviewPanel
          key={`${refreshKey}-${organizationId}`}
          organizationId={organizationId}
        />
      </PanelErrorBoundary>
    </>
  );
}
