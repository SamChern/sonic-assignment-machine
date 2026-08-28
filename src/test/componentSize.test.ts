import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * A 500-line ceiling on components. Files above it are hard to read, hard to
 * review and almost always doing two jobs.
 *
 * The legacy list below is a debt ledger, not an exemption: each entry records
 * the file's size when the ceiling landed. New files must come in under 500, and
 * a ledger file may only shrink — growing one fails this test, so the debt can
 * only be paid down.
 */
const LIMIT = 500;

const LEGACY: Record<string, number> = {
  "src/pages/admin/AdminWorkbench.tsx": 1296,
  "src/components/ConfidenceBreakdownPanel.tsx": 1235,
  "src/pages/SemanticAnalysis.tsx": 1216,
  "src/components/admin/IntuiziConsolePanel.tsx": 1131,
  "src/components/PostIngestionWizard.tsx": 1098,
  "src/components/AggregateNetworkVisualization.tsx": 987,
  "src/components/SpeechNormalizationPanel.tsx": 815,
  "src/pages/IngestionCompatibility.tsx": 809,
  "src/components/enterprise/CategoryProfileEditor.tsx": 779,
  "src/components/NetworkVisualization.tsx": 767,
  "src/pages/IntegrationStatus.tsx": 758,
  "src/components/enterprise/PredictUsersPanel.tsx": 708,
  "src/pages/Index.tsx": 660,
  "src/components/AnalysisResults.tsx": 613,
  "src/components/FingerprintComparison.tsx": 573,
  "src/components/visuals/SonicSimPanel.tsx": 560,
  "src/pages/AdminIntegrations.tsx": 552,
  "src/components/visuals/AudioscopeCompare.tsx": 537,
  "src/components/InspectMappingPanel.tsx": 537,
  "src/components/enterprise/PredictOutcomesPanel.tsx": 512,
};

const SKIP = ["src/components/ui", "src/test", "__tests__"];

const walk = (dir: string, out: string[] = []): string[] => {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (SKIP.some((s) => full.includes(s))) continue;
    if (statSync(full).isDirectory()) walk(full, out);
    else if (full.endsWith(".tsx")) out.push(full);
  }
  return out;
};

describe("component size ceiling", () => {
  const files = walk("src");

  it("finds components to check", () => {
    expect(files.length).toBeGreaterThan(20);
  });

  it("keeps every component at or under 500 lines, legacy files shrinking only", () => {
    const violations: string[] = [];
    for (const file of files) {
      const lines = readFileSync(file, "utf8").replace(/\n$/, "").split("\n").length;
      const budget = LEGACY[file] ?? LIMIT;
      if (lines > budget) {
        violations.push(
          `${file}: ${lines} lines exceeds ${budget}${LEGACY[file] ? " (recorded legacy size — split it, don't grow it)" : ""}`,
        );
      }
    }
    expect(violations, violations.join("\n")).toEqual([]);
  });

  it("has no stale legacy entries", () => {
    const stale = Object.keys(LEGACY).filter((f) => !files.includes(f));
    expect(stale, `remove from LEGACY: ${stale.join(", ")}`).toEqual([]);
  });
});
