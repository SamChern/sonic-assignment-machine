import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, useLocation, useNavigate } from "react-router-dom";
import { AuthProvider } from "@/hooks/useAuth";
import { Suspense, lazy, useEffect } from "react";

import PwaUpdateBanner from "@/components/PwaUpdateBanner";
import MobileBottomNav from "@/components/MobileBottomNav";
import Index from "./pages/Index";

const Auth = lazy(() => import("./pages/Auth"));
const ResetPassword = lazy(() => import("./pages/ResetPassword"));

const AdminDashboard = lazy(() => import("./pages/AdminDashboard"));
const AdminIntegrations = lazy(() => import("./pages/AdminIntegrations"));
const AdminConnected = lazy(() => import("./pages/AdminConnected"));
const AdminCTV = lazy(() => import("./pages/AdminCTV"));
const IntegrationStatus = lazy(() => import("./pages/IntegrationStatus"));
const IngestionCompatibility = lazy(() => import("./pages/IngestionCompatibility"));
const SemanticAnalysis = lazy(() => import("./pages/SemanticAnalysis"));
const Workspace = lazy(() => import("./pages/Workspace"));
const Demo = lazy(() => import("./pages/Demo"));
const NotFound = lazy(() => import("./pages/NotFound"));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 2 * 60 * 1000,
      gcTime: 10 * 60 * 1000,
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

const RouteFallback = () => (
  <div className="flex min-h-screen items-center justify-center">
    <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
  </div>
);

const SESSION_FLAG = "sonicsim.sessionStarted";

const stableRefreshPaths = new Set(["/", "/admin", "/auth", "/reset-password", "/workspace"]);

const refreshedPage = () => {
  const [entry] = performance.getEntriesByType("navigation") as PerformanceNavigationTiming[];
  return entry?.type === "reload" || performance.navigation?.type === 1;
};

/**
 * A brand-new session or hard refresh should land on the site home or admin
 * dashboard, never on a deep tool page such as APIs & MCPs.
 */
const FreshSessionAdminHome = () => {
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    const fresh = sessionStorage.getItem(SESSION_FLAG) !== "1";
    sessionStorage.setItem(SESSION_FLAG, "1");
    const shouldResetRoute = fresh || refreshedPage();
    if (!shouldResetRoute || stableRefreshPaths.has(location.pathname)) return;

    if (location.pathname.startsWith("/admin")) {
      navigate("/admin", { replace: true });
      return;
    }

    navigate("/", { replace: true });
    // Intentionally runs once per app load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return null;
};

const App = () => (
  <QueryClientProvider client={queryClient}>
    <AuthProvider>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <PwaUpdateBanner />
        <BrowserRouter>
          <FreshSessionAdminHome />
          <div className="pb-mobile-nav">
          <Suspense fallback={<RouteFallback />}>

            <Routes>
              <Route path="/" element={<Index />} />
              <Route path="/auth" element={<Auth />} />
              <Route path="/reset-password" element={<ResetPassword />} />

              <Route path="/admin" element={<AdminDashboard />} />
              <Route path="/admin/integrations" element={<AdminIntegrations />} />
              <Route path="/admin/connected" element={<AdminConnected />} />
              <Route path="/admin/ctv" element={<AdminCTV />} />
              <Route path="/admin/pipeline" element={<IntegrationStatus />} />
              <Route path="/admin/compatibility" element={<IngestionCompatibility />} />

              <Route path="/admin/semantic" element={<SemanticAnalysis />} />

              <Route path="/workspace" element={<Workspace />} />
              <Route path="/demo" element={<Demo />} />


              {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
              <Route path="*" element={<NotFound />} />
            </Routes>
          </Suspense>
          </div>
          <MobileBottomNav />
        </BrowserRouter>
      </TooltipProvider>
    </AuthProvider>
  </QueryClientProvider>
);

export default App;
