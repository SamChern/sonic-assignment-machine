import { Button } from "@/components/ui/button";
import { AggregateNetworkVisualization } from "@/components/AggregateNetworkVisualization";
import type { EntityMode } from "./types";

interface AggregateTabProps {
  entityMode: EntityMode;
  scopedFingerprints: any[];
  signalPointsCount: number;
  activeFilterCount: number;
  allFingerprintsCount: number;
  fingerprintsLoading: boolean;
  refreshFingerprints: () => void;
  onUserClick: (userId: string) => void;
}

/** "Aggregate" tab — the bubble network of user/cohort fingerprints. */
export function AggregateTab({
  entityMode,
  scopedFingerprints,
  signalPointsCount,
  activeFilterCount,
  allFingerprintsCount,
  fingerprintsLoading,
  refreshFingerprints,
  onUserClick,
}: AggregateTabProps) {
  return (
    <>
      <div className="flex justify-between items-center">
        <div>
          <h3 className="text-lg font-semibold text-foreground">
            {entityMode === "signal" ? "Aggregate Cohort Fingerprints" : "Aggregate User Fingerprints"}
          </h3>
          <p className="text-sm text-muted-foreground">
            {entityMode === "signal"
              ? "Each bubble represents a pseudonymized identifier cohort rolled up from Intuizi signals"
              : "Each bubble represents a user's combined ontological fingerprint"}
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            Scope: {entityMode === "signal"
              ? `identifier cohorts • ${scopedFingerprints.length} cohort fingerprint${scopedFingerprints.length !== 1 ? "s" : ""} from ${signalPointsCount.toLocaleString()} identifiers`
              : activeFilterCount > 0
                ? `${entityMode === "user" ? "users" : "signal providers"} filter • ${scopedFingerprints.length} of ${allFingerprintsCount} fingerprints`
                : `all ${allFingerprintsCount} fingerprints`}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={refreshFingerprints} disabled={fingerprintsLoading}>
          {fingerprintsLoading ? 'Loading...' : 'Refresh'}
        </Button>
      </div>
      <AggregateNetworkVisualization
        fingerprints={scopedFingerprints}
        onUserClick={onUserClick}
      />
    </>
  );
}
