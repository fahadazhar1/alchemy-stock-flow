import { Outlet } from "react-router-dom";
import { AppSidebar } from "./AppSidebar";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { GlobalSearch } from "./GlobalSearch";
import { ThemeToggle } from "./ThemeToggle";
import { StoreSelector } from "./StoreSelector";

export function AppLayout() {
  return (
    <>
      <AppSidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-14 flex items-center border-b bg-card px-4 gap-3 shrink-0">
          <SidebarTrigger />
          <StoreSelector />
          <div className="flex-1" />
          <GlobalSearch />
          <ThemeToggle />
          <span className="text-xs text-muted-foreground hidden sm:inline">Pakistan (UTC+5)</span>
        </header>
        <main className="flex-1 overflow-auto p-3 sm:p-6">
          <Outlet />
        </main>
      </div>
    </>
  );
}
