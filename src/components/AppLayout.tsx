import { useEffect } from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { AppSidebar } from "./AppSidebar";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { GlobalSearch } from "./GlobalSearch";
import { ThemeToggle } from "./ThemeToggle";
import { StoreSelector, ALL_STORES_ROUTES } from "./StoreSelector";
import { useAuth } from "@/contexts/AuthContext";
import { usePageVisibility } from "@/hooks/usePageVisibility";
import { useStore } from "@/contexts/StoreContext";

function ViewerRouteGuard() {
  const { isViewer } = useAuth();
  const { isPageVisible, isLoaded } = usePageVisibility();
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    if (!isViewer || !isLoaded) return;
    if (!isPageVisible(location.pathname)) {
      navigate("/dashboard", { replace: true });
    }
  }, [location.pathname, isViewer, isLoaded]);

  return null;
}

// If "All Stores" is active and the user navigates to a page that isn't
// built for an aggregate view, fall back to a single store instead of
// leaving the page showing mixed-currency/confusing data.
function StoreScopeGuard() {
  const { stores, isAllStores, setSelectedStoreId } = useStore();
  const location = useLocation();

  useEffect(() => {
    if (!isAllStores || stores.length === 0) return;
    if (ALL_STORES_ROUTES.includes(location.pathname)) return;
    setSelectedStoreId(stores[0].id);
  }, [location.pathname, isAllStores, stores]);

  return null;
}

export function AppLayout() {
  return (
    <>
      <ViewerRouteGuard />
      <StoreScopeGuard />
      <div className="print:hidden contents">
        <AppSidebar />
      </div>
      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-14 flex items-center border-b bg-card px-4 gap-3 shrink-0 print:hidden">
          <SidebarTrigger />
          <StoreSelector />
          <div className="flex-1" />
          <GlobalSearch />
          <ThemeToggle />
          <span className="text-xs text-muted-foreground hidden sm:inline">Pakistan (UTC+5)</span>
        </header>
        <main className="flex-1 overflow-auto p-3 sm:p-6 print:p-0 print:overflow-visible">
          <Outlet />
        </main>
      </div>
    </>
  );
}
