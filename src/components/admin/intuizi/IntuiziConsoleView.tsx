/**
 * The Intuizi Console tab: live scoring-run dashboard, queue health and the MCP
 * console, grouped in one place for operators.
 */
import ScoringRunsDashboard from "@/components/admin/intuizi/ScoringRunsDashboard";
import ScoreQueueHealthPanel from "@/components/ScoreQueueHealthPanel";
import IntuiziConsolePanel from "@/components/admin/IntuiziConsolePanel";

export const IntuiziConsoleView = () => (
  <div className="space-y-6">
    <p className="text-sm text-muted-foreground">
      Live view of the Intuizi scoring pipeline — what is waiting, what is being scored right now,
      and what has just finished — plus the MCP console for browsing audiences and handing
      deliveries to ingest.
    </p>
    <ScoringRunsDashboard />
    <ScoreQueueHealthPanel />
    <IntuiziConsolePanel />
  </div>
);

export default IntuiziConsoleView;
