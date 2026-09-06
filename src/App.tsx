import { ThemeProvider } from "next-themes";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Outlet, useLocation, useNavigate } from "react-router-dom";
import { AuthProvider } from "@/hooks/useAuth";
import { Suspense, lazy, useEffect } from "react";

import AppErrorBoundary from "@/components/AppErrorBoundary";
import AdminErrorBoundary from "@/components/AdminErrorBoundary";
import RequireAdmin from "@/components/RequireAdmin";
import MobileBottomNav from "@/components/MobileBottomNav";
import MobileAuthFallback from "@/components/MobileAuthFallback";

import VersionStatusPanel from "@/components/VersionStatusPanel";
import Index from "./pages/Index";

const Auth = lazy(() => import("./pages/Auth"));
const ResetPassword = lazy(() => import("./pages/ResetPassword"));
const OAuthConsent = lazy(() => import("./pages/OAuthConsent"));

const AdminDashboard = lazy(() => import("./pages/AdminDashboard"));
const AdminWorkbench = lazy(() => import("./pages/admin/AdminWorkbench"));
const AdminEc2 = lazy(() => import("./pages/admin/AdminEc2"));
const AdminIntegrations = lazy(() => import("./pages/AdminIntegrations"));
const AdminIntegrationSetup = lazy(() => import("./pages/AdminIntegrationSetup"));
const AdminConnected = lazy(() => import("./pages/AdminConnected"));
const AdminCTV = lazy(() => import("./pages/AdminCTV"));
const AdminActivationGrants = lazy(() => import("./pages/AdminActivationGrants"));
const AdminControlRoom = lazy(() => import("./pages/AdminControlRoom"));
const AdminSoundLibrary = lazy(() => import("./pages/admin/AdminSoundLibrary"));
const AdminGuide = lazy(() => import("./pages/admin/AdminGuide"));
const AdminSetup = lazy(() => import("./pages/admin/AdminSetup"));
const AdminResolver = lazy(() => import("./pages/admin/AdminResolver"));
const AdminDemoRequests = lazy(() => import("./pages/admin/AdminDemoRequests"));
const AdminCreatorApplications = lazy(() => import("./pages/admin/AdminCreatorApplications"));
const AdminNextLevelLab = lazy(() => import("./pages/admin/AdminNextLevelLab"));
const Methodology = lazy(() => import("./pages/Methodology"));
const CreatorDoor = lazy(() => import("./pages/CreatorDoor"));
const CreatorApply = lazy(() => import("./pages/CreatorApply"));
const EnterpriseInquiry = lazy(() => import("./pages/EnterpriseInquiry"));
const CreatorProfile = lazy(() => import("./pages/CreatorProfile"));
const CreatorSpace = lazy(() => import("./pages/CreatorSpace"));
const ListenerSpace = lazy(() => import("./pages/ListenerSpace"));
const ListenerApp = lazy(() => import("./pages/ListenerApp"));
const MusicCatalog = lazy(() => import("./pages/MusicCatalog"));
const SymbolMarket = lazy(() => import("./pages/SymbolMarket"));


const IntegrationStatus = lazy(() => import("./pages/IntegrationStatus"));
const IngestionCompatibility = lazy(() => import("./pages/IngestionCompatibility"));
const SemanticAnalysis = lazy(() => import("./pages/SemanticAnalysis"));
const Workspace = lazy(() => import("./pages/Workspace"));
const Portal = lazy(() => import("./pages/Portal"));
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

// Shareable, linkable destinations: a fresh session or hard refresh stays put.
const stableRefreshPaths = new Set([
  "/",
  "/admin",
  "/auth",
  "/reset-password",
  "/workspace",
  "/listen",
  "/creator",
  "/methodology",
]);

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
  <ThemeProvider attribute="class" defaultTheme="light" enableSystem storageKey="sonicsim-theme">
  <QueryClientProvider client={queryClient}>
    <AuthProvider>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter>
          <FreshSessionAdminHome />
          <div className="pb-mobile-nav">
          <AppErrorBoundary>
          <Suspense fallback={<RouteFallback />}>

            <Routes>
              <Route path="/" element={<Index />} />
              <Route path="/auth" element={<Auth />} />
              <Route path="/reset-password" element={<ResetPassword />} />
              <Route path="/.lovable/oauth/consent" element={<OAuthConsent />} />

              {/* One gate for every admin screen: access checked once, crashes
                  contained once, no per-route wrappers to keep in sync. */}
              {/* Any signed-in enterprise account can ask for a demo and track it;
                  admins see the whole queue on the same page. */}
              <Route path="/admin/demo-requests" element={<AdminDemoRequests />} />
              <Route
                path="/admin/creator-applications"
                element={<AdminCreatorApplications />}
              />
              <Route
                path="/admin"
                element={
                  <RequireAdmin>
                    <AdminErrorBoundary>
                      <Outlet />
                    </AdminErrorBoundary>
                  </RequireAdmin>
                }
              >
                <Route index element={<AdminDashboard />} />
                <Route path="workbench" element={<AdminWorkbench />} />
                <Route path="ec2" element={<AdminEc2 />} />
                <Route path="integrations" element={<AdminIntegrations />} />
                <Route path="integrations/:integrationId" element={<AdminIntegrationSetup />} />

                <Route path="connected" element={<AdminConnected />} />
                <Route path="ctv" element={<AdminCTV />} />
                <Route path="activations" element={<AdminActivationGrants />} />
                <Route path="control-room" element={<AdminControlRoom />} />
                <Route path="sound-library" element={<AdminSoundLibrary />} />
                <Route path="guide" element={<AdminGuide />} />
                <Route path="setup" element={<AdminSetup />} />
                <Route path="resolver" element={<AdminResolver />} />
                <Route path="lab" element={<AdminNextLevelLab />} />
                <Route path="pipeline" element={<IntegrationStatus />} />
                <Route path="compatibility" element={<IngestionCompatibility />} />
                <Route path="semantic" element={<SemanticAnalysis />} />
              </Route>
              <Route path="/methodology" element={<Methodology />} />

              <Route path="/portal" element={<Portal />} />
              <Route path="/workspace" element={<Workspace />} />
              <Route path="/listener" element={<ListenerSpace />} />
              <Route path="/listen" element={<ListenerApp />} />
              <Route path="/creator" element={<CreatorDoor />} />
              <Route path="/creator/apply" element={<CreatorApply />} />
              <Route path="/creator/profile" element={<CreatorProfile />} />
              <Route path="/creator/space" element={<CreatorSpace />} />
              <Route path="/enterprise/demo" element={<EnterpriseInquiry />} />
              <Route path="/library/catalog" element={<MusicCatalog />} />
              <Route path="/market" element={<SymbolMarket />} />


              <Route path="/demo" element={<Demo />} />


              {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
              <Route path="*" element={<NotFound />} />
            </Routes>
          </Suspense>
          </AppErrorBoundary>

          </div>
          <MobileAuthFallback />
          <MobileBottomNav />

          <VersionStatusPanel />

        </BrowserRouter>
      </TooltipProvider>
    </AuthProvider>
  </QueryClientProvider>
  </ThemeProvider>
);

export default App;
