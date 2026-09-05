import { Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PanelErrorBoundary } from "@/components/PanelErrorBoundary";
import { useNextLevelFlags } from "@/hooks/useNextLevelFlags";
import { NextLevelFlagsPanel } from "@/components/nextlevel/NextLevelFlagsPanel";
import { ResonanceLabPanel } from "@/components/nextlevel/ResonanceLabPanel";
import { CommonsPanel } from "@/components/nextlevel/CommonsPanel";
import { OnDevicePanel } from "@/components/nextlevel/OnDevicePanel";
import { HearApiPanel } from "@/components/nextlevel/HearApiPanel";
import { FramesPanel } from "@/components/nextlevel/FramesPanel";
import { PassportPanel } from "@/components/nextlevel/PassportPanel";
import { SensoryPanel } from "@/components/nextlevel/SensoryPanel";
import { LiveContextPanel } from "@/components/nextlevel/LiveContextPanel";
import { LearningLoopPanel } from "@/components/nextlevel/LearningLoopPanel";

/**
 * The Lab — Batch E. Nine new capabilities, admin-only and each behind its own
 * switch, so they can be tried here long before anyone else sees them.
 */
export default function AdminNextLevelLab() {
  const { flags, loading, setFlag } = useNextLevelFlags();

  return (
    <main className="container mx-auto max-w-5xl space-y-6 px-4 py-8">
      <div className="space-y-2">
        <Button asChild variant="ghost" size="sm">
          <Link to="/admin">
            <ArrowLeft className="mr-2 h-4 w-4" aria-hidden="true" />
            Back to the admin dashboard
          </Link>
        </Button>
        <h1 className="text-3xl font-semibold">The Lab</h1>
        <p className="text-muted-foreground">
          Nine new capabilities, each switched off by default. Try them here, then turn one on when
          you are happy with it.
        </p>
      </div>

      <PanelErrorBoundary label="Switches">
        <NextLevelFlagsPanel flags={flags} loading={loading} setFlag={setFlag} />
      </PanelErrorBoundary>

      <PanelErrorBoundary label="Resonance Point">
        <ResonanceLabPanel />
      </PanelErrorBoundary>

      <PanelErrorBoundary label="Sonic Commons">
        <CommonsPanel />
      </PanelErrorBoundary>

      <PanelErrorBoundary label="Scoring in the browser">
        <OnDevicePanel />
      </PanelErrorBoundary>

      <PanelErrorBoundary label="hear() for other systems">
        <HearApiPanel />
      </PanelErrorBoundary>

      <PanelErrorBoundary label="Seen and heard together">
        <FramesPanel />
      </PanelErrorBoundary>

      <PanelErrorBoundary label="Sonic Passport">
        <PassportPanel />
      </PanelErrorBoundary>

      <PanelErrorBoundary label="Felt and seen signatures">
        <SensoryPanel />
      </PanelErrorBoundary>

      <PanelErrorBoundary label="The sound of a place">
        <LiveContextPanel />
      </PanelErrorBoundary>

      <PanelErrorBoundary label="Weekly learning note">
        <LearningLoopPanel />
      </PanelErrorBoundary>
    </main>
  );
}
