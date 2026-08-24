import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthProvider } from "@/hooks/useAuth";
import { Suspense, lazy } from "react";
import PwaUpdateBanner from "@/components/PwaUpdateBanner";
import MobileBottomNav from "@/components/MobileBottomNav";
import Index from "./pages/Index";

const Auth = lazy(() => import("./pages/Auth"));
const AdminDashboard = lazy(() => import("./pages/AdminDashboard"));
const AdminIntegrations = lazy(() => import("./pages/AdminIntegrations"));
const AdminConnected = lazy(() => import("./pages/AdminConnected"));
const AdminCTV = lazy(() => import("./pages/AdminCTV"));
const IntegrationStatus = lazy(() => import("./pages/IntegrationStatus"));
const IngestionCompatibility = lazy(() => import("./pages/IngestionCompatibility"));
const SemanticAnalysis = lazy(() => import("./pages/SemanticAnalysis"));
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

const App = () => (
  <QueryClientProvider client={queryClient}>
    <AuthProvider>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <PwaUpdateBanner />
        <BrowserRouter>
          <div className="pb-mobile-nav">
          <Suspense fallback={<RouteFallback />}>
            <Routes>
              <Route path="/" element={<Index />} />
              <Route path="/auth" element={<Auth />} />
              <Route path="/admin" element={<AdminDashboard />} />
              <Route path="/admin/integrations" element={<AdminIntegrations />} />
              <Route path="/admin/connected" element={<AdminConnected />} />
              <Route path="/admin/ctv" element={<AdminCTV />} />
              <Route path="/admin/pipeline" element={<IntegrationStatus />} />
              <Route path="/admin/compatibility" element={<IngestionCompatibility />} />

              <Route path="/admin/semantic" element={<SemanticAnalysis />} />


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
