import {
  LayoutDashboard, Package, RefreshCw, Brain, Bot, FileText,
  BarChart3, Truck, CheckSquare, FlaskConical, Clock, Settings, Beaker, Store,
  ShoppingCart, BarChart2, ListOrdered, Activity, LogOut,
} from "lucide-react";
import { NavLink } from "@/components/NavLink";
import { useLocation } from "react-router-dom";
import {
  Sidebar, SidebarContent, SidebarGroup, SidebarGroupContent,
  SidebarGroupLabel, SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarFooter, useSidebar,
} from "@/components/ui/sidebar";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";

const navItems = [
  { title: "Dashboard", url: "/dashboard", icon: LayoutDashboard },
  { title: "Orders",    url: "/orders",    icon: ShoppingCart },
  { title: "Reports",   url: "/reports",   icon: BarChart2 },
  { title: "Product Master", url: "/products", icon: Package },
  { title: "Manual Sync", url: "/manual-sync", icon: RefreshCw },
  { title: "AI Co-Pilot", url: "/ai-copilot", icon: Brain },
  { title: "Auto-Pilot", url: "/auto-pilot", icon: Bot },
  { title: "Approval Queue", url: "/approvals", icon: CheckSquare },
  { title: "Campaigns", url: "/campaigns", icon: BarChart3 },
  { title: "Simulation", url: "/simulation", icon: FlaskConical },
  { title: "Replenishment", url: "/replenishment", icon: Truck },
  { title: "Product Velocity", url: "/product-velocity", icon: Activity },
  { title: "Expiry Monitor", url: "/expiry", icon: Clock },
  { title: "Audit Logs", url: "/audit-logs", icon: FileText },
  { title: "Collection Sort", url: "/collection-sort", icon: ListOrdered },
  { title: "Stores", url: "/stores", icon: Store },
  { title: "Settings", url: "/settings", icon: Settings },
];

export function AppSidebar() {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const location = useLocation();
  const { user, role, signOut } = useAuth();

  return (
    <Sidebar collapsible="icon">
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>
            {!collapsed && (
              <div className="flex items-center gap-2">
                <Beaker className="h-4 w-4 text-sidebar-primary" />
                <span className="font-bold text-sidebar-primary">Inventory Alchemist</span>
              </div>
            )}
            {collapsed && <Beaker className="h-4 w-4 text-sidebar-primary" />}
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {navItems.map((item) => (
                <SidebarMenuItem key={item.url}>
                  <SidebarMenuButton asChild>
                    <NavLink
                      to={item.url}
                      end
                      className="hover:bg-sidebar-accent/50"
                      activeClassName="bg-sidebar-accent text-sidebar-primary font-medium"
                    >
                      <item.icon className="h-4 w-4 shrink-0" />
                      {!collapsed && <span>{item.title}</span>}
                    </NavLink>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter className="p-2 border-t">
        {!collapsed ? (
          <div className="flex items-center justify-between gap-2 px-1 py-1">
            <div className="min-w-0">
              <p className="text-xs font-medium truncate">{user?.email}</p>
              <p className="text-[11px] text-muted-foreground capitalize">{role ?? "viewer"}</p>
            </div>
            <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={signOut} title="Sign out">
              <LogOut className="h-3.5 w-3.5" />
            </Button>
          </div>
        ) : (
          <Button variant="ghost" size="icon" className="h-7 w-7 w-full" onClick={signOut} title="Sign out">
            <LogOut className="h-3.5 w-3.5" />
          </Button>
        )}
      </SidebarFooter>
    </Sidebar>
  );
}
