import { Link, useLocation } from "react-router-dom";
import { Building2, LogIn, Shield, User } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useOrganization } from "@/hooks/useOrganization";
import { Button } from "@/components/ui/button";

/**
 * Mobile-only header fallback for account access.
 * Guarantees sign-in / workspace links stay reachable on routes whose own header
 * has no auth controls, or when the bottom nav is not visible.
 */
export function MobileAuthFallback() {
  const { pathname } = useLocation();
  const { user, isAdmin, loading } = useAuth();
  const { orgs } = useOrganization();

  // Homepage header and the auth page already expose these actions.
  if (pathname === "/" || pathname === "/auth" || pathname === "/listen" || loading)
    return null;

  return (
    <div className="z-nav fixed right-2 top-2 flex items-center gap-1.5 sm:hidden">
      {user ? (
        <>
          {orgs.length > 0 && (
            <Link to="/workspace" aria-label="Enterprise workspace">
              <Button
                size="sm"
                variant="outline"
                className="min-h-11 min-w-11 border-primary/50 bg-background/90 text-primary backdrop-blur-md"
              >
                <Building2 className="h-4 w-4" />
              </Button>
            </Link>
          )}
          {isAdmin && (
            <Link to="/admin" aria-label="Admin dashboard">
              <Button
                size="sm"
                variant="outline"
                className="min-h-11 min-w-11 border-primary/50 bg-background/90 text-primary backdrop-blur-md"
              >
                <Shield className="h-4 w-4" />
              </Button>
            </Link>
          )}
          <Link to="/auth" aria-label="Account">
            <Button
              size="sm"
              variant="outline"
              className="min-h-11 min-w-11 bg-background/90 backdrop-blur-md"
            >
              <User className="h-4 w-4" />
            </Button>
          </Link>
        </>
      ) : (
        <Link to="/auth" aria-label="Sign in">
          <Button
            size="sm"
            className="min-h-11 gap-1.5 bg-background/90 text-xs backdrop-blur-md"
            variant="outline"
          >
            <LogIn className="h-4 w-4" />
            Sign in
          </Button>
        </Link>
      )}
    </div>
  );
}

export default MobileAuthFallback;
