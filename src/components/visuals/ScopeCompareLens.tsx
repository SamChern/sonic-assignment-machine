import { History, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SonicSimPanel } from "@/components/visuals/SonicSimPanel";
import { FingerprintComparison } from "@/components/FingerprintComparison";

export type ScopeCompareMode = "all" | "recent";

interface ScopeCompareLensProps {
  /** Fingerprints already narrowed by the caller's filters. */
  fingerprints: any[];
  /** Maps a fingerprint to the six-axis scores the audioscope animates. */
  toScores: (fingerprint: any, mode: ScopeCompareMode) => Record<string, number>;
  mode: ScopeCompareMode;
  onModeChange: (mode: ScopeCompareMode) => void;
  /** "signal" swaps the copy from users to identifier cohorts. */
  entityMode: "user" | "signal" | "provider";
  scopeSummary: string;
  onRefresh?: () => void;
  refreshing?: boolean;
  /** "debug" adds the admin diagnostic strip to the scope panel. */
  lens?: "consumer" | "enterprise" | "debug";
}

/**
 * The compare lens of the Semantic Scope: one signal, two synchronized reads —
 * the animated audioscope of any subject in scope, and the overlaid radar of
 * every fingerprint in it. Previously two separate tabs (Audioscope + Compare
 * Fingerprints); folding them here keeps a single mental model of "scope".
 */
export const ScopeCompareLens = ({
  fingerprints,
  toScores,
  mode,
  onModeChange,
  entityMode,
  scopeSummary,
  onRefresh,
  refreshing,
  lens = "enterprise",
}: ScopeCompareLensProps) => {
  const isSignal = entityMode === "signal";

  return (
    <div className="space-y-6">
      <SonicSimPanel
        lens={lens}
        title={isSignal ? "See this cohort's SonicSIM" : "See my SonicSIM"}
        description="Animated audioscope of any fingerprint in the current scope — switch subjects to compare identity rings and node pulses."
        subjects={fingerprints.map((fp: any) => ({
          id: fp.user_id,
          label: fp.username || "User",
          sublabel: `${fp.total_sources_analyzed ?? 0} sources analyzed`,
          scores: toScores(fp, mode),
        }))}
      />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold text-foreground">
            {isSignal ? "Compare Cohort Fingerprints" : "Compare User Fingerprints"}
          </h3>
          <p className="text-sm text-muted-foreground">
            {isSignal
              ? "Overlay identifier cohorts against each other and the meta rollup"
              : "Select 2 or more users to overlay their radar charts side-by-side"}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">Scope: {scopeSummary}</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="inline-flex rounded-md border border-border bg-muted p-0.5">
            <Button
              size="sm"
              variant={mode === "all" ? "default" : "ghost"}
              className="h-9 shrink-0 gap-1.5 whitespace-nowrap"
              onClick={() => onModeChange("all")}
            >
              <History className="h-3.5 w-3.5" />
              All-Time
            </Button>
            <Button
              size="sm"
              variant={mode === "recent" ? "default" : "ghost"}
              className="h-9 shrink-0 gap-1.5 whitespace-nowrap"
              onClick={() => onModeChange("recent")}
            >
              <Clock className="h-3.5 w-3.5" />
              Last 30 Days
            </Button>
          </div>
          {onRefresh && (
            <Button variant="outline" size="sm" onClick={onRefresh} disabled={refreshing}>
              {refreshing ? "Loading..." : "Refresh"}
            </Button>
          )}
        </div>
      </div>

      <FingerprintComparison fingerprints={fingerprints} mode={mode as any} />
    </div>
  );
};
