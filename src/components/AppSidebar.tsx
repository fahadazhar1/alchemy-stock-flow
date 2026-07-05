import {
  LayoutDashboard, Package, RefreshCw, Brain, Bot, FileText,
  BarChart3, Truck, CheckSquare, FlaskConical, Clock, Settings, BookOpen, Store,
  ShoppingCart, BarChart2, ListOrdered, Activity, LogOut, ChevronRight, History,
  PackageCheck, ClipboardList, Tag, Archive, PackageOpen, Search, Globe2,
} from "lucide-react";
import { NavLink } from "@/components/NavLink";
import { useLocation } from "react-router-dom";
import {
  Sidebar, SidebarContent, SidebarGroup, SidebarGroupContent,
  SidebarGroupLabel, SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarFooter, useSidebar,
  SidebarMenuSub, SidebarMenuSubButton, SidebarMenuSubItem,
} from "@/components/ui/sidebar";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { useAuth } from "@/contexts/AuthContext";
import { usePageVisibility } from "@/hooks/usePageVisibility";
import { Button } from "@/components/ui/button";

const navItems = [
  { title: "Dashboard", url: "/dashboard", icon: LayoutDashboard },
  { title: "Store Performance - WIP", url: "/store-performance", icon: Globe2 },
  { title: "Orders",    url: "/orders",    icon: ShoppingCart },
  { title: "Reports",   url: "/reports",   icon: BarChart2 },
  {
    title: "Product Master", url: "/products", icon: Package,
    children: [
      { title: "All Products", url: "/products", icon: Package },
      { title: "Inventory Adjustments", url: "/products/inventory-history", icon: History },
    ],
  },
  { title: "Sales Campaign", url: "/manual-sync", icon: RefreshCw },
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
  { title: "Fulfillment", url: "/fulfillment", icon: PackageCheck },
  { title: "Draft PO", url: "/draft-po", icon: ClipboardList },
  { title: "Discount Performance", url: "/discount-performance", icon: Tag },
  { title: "Dead Stock", url: "/dead-stock", icon: Archive },
  { title: "Bundle Finder", url: "/bundle-finder", icon: PackageOpen },
  { title: "SEO Audit", url: "/seo-audit", icon: Search },
  { title: "Stores", url: "/stores", icon: Store },
  { title: "Settings", url: "/settings", icon: Settings },
];

export function AppSidebar() {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const location = useLocation();
  const { user, role, isAdmin, signOut } = useAuth();
  const { isPageVisible, isLoaded } = usePageVisibility();

  const visibleNavItems = isAdmin || !isLoaded
    ? navItems
    : navItems.filter(item => isPageVisible(item.url));

  return (
    <Sidebar collapsible="icon">
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>
            {!collapsed && (
              <div className="flex items-center gap-2">
                <BookOpen className="h-4 w-4 text-sidebar-primary" />
                <span className="font-bold text-sidebar-foreground tracking-wide">Darussalam</span>
              </div>
            )}
            {collapsed && <BookOpen className="h-4 w-4 text-sidebar-primary" />}
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {visibleNavItems.map((item) => {
                if (!item.children) {
                  return (
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
                  );
                }

                const isActiveGroup = location.pathname.startsWith(item.url);
                return (
                  <Collapsible key={item.url} defaultOpen={isActiveGroup} className="group/collapsible">
                    <SidebarMenuItem>
                      <CollapsibleTrigger asChild>
                        <SidebarMenuButton className="hover:bg-sidebar-accent/50">
                          <item.icon className="h-4 w-4 shrink-0" />
                          {!collapsed && (
                            <>
                              <span>{item.title}</span>
                              <ChevronRight className="ml-auto h-4 w-4 shrink-0 transition-transform group-data-[state=open]/collapsible:rotate-90" />
                            </>
                          )}
                        </SidebarMenuButton>
                      </CollapsibleTrigger>
                      <CollapsibleContent>
                        <SidebarMenuSub>
                          {item.children.map((child) => (
                            <SidebarMenuSubItem key={child.url}>
                              <SidebarMenuSubButton asChild>
                                <NavLink
                                  to={child.url}
                                  end
                                  activeClassName="bg-sidebar-accent text-sidebar-primary font-medium"
                                >
                                  <child.icon className="h-3.5 w-3.5 shrink-0" />
                                  <span>{child.title}</span>
                                </NavLink>
                              </SidebarMenuSubButton>
                            </SidebarMenuSubItem>
                          ))}
                        </SidebarMenuSub>
                      </CollapsibleContent>
                    </SidebarMenuItem>
                  </Collapsible>
                );
              })}
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
