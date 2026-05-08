import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SidebarProvider } from "@/components/ui/sidebar";
import { StoreProvider } from "@/contexts/StoreContext";
import { AppLayout } from "@/components/AppLayout";
import LegacyDashboard from "@/pages/LegacyDashboard";
import Dashboard from "@/pages/v2/Dashboard";
import Orders from "@/pages/v2/Orders";
import Reports from "@/pages/v2/Reports";
import ProductMaster from "@/pages/ProductMaster";
import ManualSync from "@/pages/ManualSync";
import AICoPilot from "@/pages/AICoPilot";
import AutoPilot from "@/pages/AutoPilot";
import AuditLogs from "@/pages/AuditLogs";
import CampaignPerformance from "@/pages/CampaignPerformance";
import Replenishment from "@/pages/Replenishment";
import ApprovalQueue from "@/pages/ApprovalQueue";
import Simulation from "@/pages/Simulation";
import ExpiryMonitoring from "@/pages/ExpiryMonitoring";
import Settings from "@/pages/Settings";
import StoreManagement from "@/pages/StoreManagement";
import NotFound from "@/pages/NotFound";

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30000, retry: 1 } },
});

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Sonner position="top-right" />
      <BrowserRouter>
        <SidebarProvider>
          <StoreProvider>
            <div className="min-h-screen flex w-full">
              <Routes>
                <Route element={<AppLayout />}>
                  <Route path="/" element={<Navigate to="/dashboard" replace />} />
                  <Route path="/dashboard" element={<Dashboard />} />
                  <Route path="/legacy/dashboard" element={<LegacyDashboard />} />
                  <Route path="/orders" element={<Orders />} />
                  <Route path="/reports" element={<Reports />} />
                  <Route path="/products" element={<ProductMaster />} />
                  <Route path="/manual-sync" element={<ManualSync />} />
                  <Route path="/ai-copilot" element={<AICoPilot />} />
                  <Route path="/auto-pilot" element={<AutoPilot />} />
                  <Route path="/audit-logs" element={<AuditLogs />} />
                  <Route path="/campaigns" element={<CampaignPerformance />} />
                  <Route path="/replenishment" element={<Replenishment />} />
                  <Route path="/approvals" element={<ApprovalQueue />} />
                  <Route path="/simulation" element={<Simulation />} />
                  <Route path="/expiry" element={<ExpiryMonitoring />} />
                  <Route path="/settings" element={<Settings />} />
                  <Route path="/stores" element={<StoreManagement />} />
                </Route>
                <Route path="*" element={<NotFound />} />
              </Routes>
            </div>
          </StoreProvider>
        </SidebarProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
