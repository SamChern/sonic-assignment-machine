import { RefObject } from "react";
import ThemeToggle from "@/components/ThemeToggle";
import DoorSwitcher from "@/components/persona/DoorSwitcher";
import type { Persona } from "@/hooks/usePersona";
import sonicSimLogo from "@/assets/SonicSIM_blend.png";

interface HomeHeaderProps {
  headerRef: RefObject<HTMLElement>;
  authLoading: boolean;
  persona: Persona;
  onSelectPersona: (persona: Persona) => void;
  isSignedIn: boolean;
  isAdmin: boolean;
  hasEnterprise: boolean;
  avatarUrl?: string | null;
  displayName?: string | null;
  onSignOut: () => void;
}

/** The fixed, scroll-reactive top bar with the compact logo and auth/door controls. */
const HomeHeader = ({
  headerRef,
  authLoading,
  persona,
  onSelectPersona,
  isSignedIn,
  isAdmin,
  hasEnterprise,
  avatarUrl,
  displayName,
  onSignOut,
}: HomeHeaderProps) => {
  return (
    <header
      ref={headerRef}
      className="fixed top-0 left-0 right-0 z-50 px-4 sm:px-6 py-2 sm:py-3 flex items-center justify-between gap-2 backdrop-blur-md border-b transition-all duration-150 ease-out will-change-[background-color,border-color]"
      style={{
        backgroundColor: 'hsl(var(--background) / var(--header-bg-opacity, 0))',
        borderColor: 'hsl(var(--border) / var(--header-border-opacity, 0))',
      }}
    >
      <div className="relative flex items-center">
        <img
          src={sonicSimLogo}
          alt="SonicSIM.ai"
          width={1264}
          height={847}
          decoding="async"
          className="h-6 sm:h-8 md:h-9 w-auto max-w-[45vw] object-contain select-none transition-opacity duration-150 ease-out will-change-opacity"
          style={{ opacity: 'var(--header-logo-opacity, 0)', filter: 'brightness(1.2)' }}
          draggable={false}
        />
      </div>

      {/* Auth Controls */}
      <div className="flex items-center gap-1.5 sm:gap-3 shrink-0">
        {/* EC2 Health check lives in the admin dashboard header */}

        <ThemeToggle className="h-8 w-8 text-muted-foreground hover:text-foreground" />

        {authLoading ? (
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        ) : (
          <DoorSwitcher
            persona={persona}
            onSelect={onSelectPersona}
            isSignedIn={isSignedIn}
            isAdmin={isAdmin}
            hasEnterprise={hasEnterprise}
            avatarUrl={avatarUrl}
            displayName={displayName}
            onSignOut={onSignOut}
          />
        )}
      </div>
    </header>
  );
};

export default HomeHeader;
