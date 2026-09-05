import { type ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";

/**
 * One place that decides whether an admin screen may render.
 *
 * Every admin page used to run its own `useEffect` redirect, which meant the
 * page body rendered (and fired its queries) for a heartbeat before bouncing a
 * non-admin out. Gating at the route keeps unauthorized data requests from ever
 * leaving the browser.
 */
const RequireAdmin = ({ children }: { children: ReactNode }) => {
  const { isAdmin, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div
          className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent"
          role="status"
          aria-label="Checking access"
        />
      </div>
    );
  }

  if (!isAdmin) {
    return <Navigate to="/" replace state={{ from: location.pathname }} />;
  }

  return <>{children}</>;
};

export default RequireAdmin;
