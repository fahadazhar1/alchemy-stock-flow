import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Navigate, Route, Routes, Outlet } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SidebarProvider } from "@/components/ui/sidebar";
import { StoreProvider } from "@/contexts/StoreContext";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { AppLayout } from "@/components/AppLayout";
import LegacyDashboard from "@/pages/LegacyDashboard";
import Dashboard from "@/pages/v2/Dashboard";
import Orders from "@/pages/v2/Orders";
import Reports from "@/pages/v2/Reports";
import ProductMaster from "@/pages/ProductMaster";
import InventoryAdjustments from "@/pages/InventoryAdjustments";
import ManualSync from "@/pages/ManualSync";
import AICoPilot from "@/pages/AICoPilot";
import AutoPilot from "@/pages/AutoPilot";
import AuditLogs from "@/pages/AuditLogs";
import CampaignPerformance from "@/pages/CampaignPerformance";
import Replenishment from "@/pages/Replenishment";
import ProductVelocity from "@/pages/ProductVelocity";
import ApprovalQueue from "@/pages/ApprovalQueue";
import Simulation from "@/pages/Simulation";
import ExpiryMonitoring from "@/pages/ExpiryMonitoring";
import Settings from "@/pages/Settings";
import StoreManagement from "@/pages/StoreManagement";
import CollectionSortManager from "@/pages/CollectionSortManager";
import OrderFulfillment from "@/pages/OrderFulfillment";
import DraftPO from "@/pages/DraftPO";
import DiscountPerformance from "@/pages/DiscountPerformance";
import DeadStock from "@/pages/DeadStock";
import BundleOpportunity from "@/pages/BundleOpportunity";
import BundleBuilder from "@/pages/BundleBuilder";
import SEOAudit from "@/pages/SEOAudit";
import StorePerformanceDashboard from "@/pages/StorePerformanceDashboard";
import PnLDashboard from "@/pages/PnLDashboard";
import ClickUpReports from "@/pages/ClickUpReports";
import FbtBundleSettings from "@/pages/FbtBundleSettings";
import Login from "@/pages/Login";
import NotFound from "@/pages/NotFound";
import { Loader2 } from "lucide-react";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60_000,        // 5 min — cut redundant re-fetches on navigation (egress)
      gcTime: 10 * 60_000,          // keep cache around so back-nav is free
      refetchOnWindowFocus: false,  // don't re-pull every heavy query on tab-back
      retry: 1,
    },
  },
});

function ProtectedRoute() {
  const { user, loading } = useAuth();

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center">
      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
    </div>
  );

  if (!user) return <Navigate to="/login" replace />;
  return <Outlet />;
}

function AppRoutes() {
  const { user, loading } = useAuth();

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center">
      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
    </div>
  );

  return (
    <Routes>
      <Route path="/login" element={user ? <Navigate to="/dashboard" replace /> : <Login />} />
      <Route element={<ProtectedRoute />}>
        <Route element={<SidebarProvider><StoreProvider><AppLayout /></StoreProvider></SidebarProvider>}>
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/legacy/dashboard" element={<LegacyDashboard />} />
          <Route path="/orders" element={<Orders />} />
          <Route path="/reports" element={<Reports />} />
          <Route path="/products" element={<ProductMaster />} />
          <Route path="/products/inventory-history" element={<InventoryAdjustments />} />
          <Route path="/manual-sync" element={<ManualSync />} />
          <Route path="/ai-copilot" element={<AICoPilot />} />
          <Route path="/auto-pilot" element={<AutoPilot />} />
          <Route path="/audit-logs" element={<AuditLogs />} />
          <Route path="/campaigns" element={<CampaignPerformance />} />
          <Route path="/replenishment" element={<Replenishment />} />
          <Route path="/product-velocity" element={<ProductVelocity />} />
          <Route path="/approvals" element={<ApprovalQueue />} />
          <Route path="/simulation" element={<Simulation />} />
          <Route path="/expiry" element={<ExpiryMonitoring />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/stores" element={<StoreManagement />} />
          <Route path="/collection-sort" element={<CollectionSortManager />} />
          <Route path="/fulfillment" element={<OrderFulfillment />} />
          <Route path="/draft-po" element={<DraftPO />} />
          <Route path="/discount-performance" element={<DiscountPerformance />} />
          <Route path="/dead-stock" element={<DeadStock />} />
          <Route path="/bundle-finder" element={<BundleOpportunity />} />
          <Route path="/bundle-builder" element={<BundleBuilder />} />
          <Route path="/fbt-bundle-discount" element={<FbtBundleSettings />} />
          <Route path="/seo-audit" element={<SEOAudit />} />
          <Route path="/store-performance" element={<StorePerformanceDashboard />} />
          <Route path="/pnl" element={<PnLDashboard />} />
          <Route path="/clickup-reports" element={<ClickUpReports />} />
        </Route>
      </Route>
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Sonner position="top-right" />
      <BrowserRouter>
        <AuthProvider>
          <div className="min-h-screen flex w-full">
            <AppRoutes />
          </div>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
