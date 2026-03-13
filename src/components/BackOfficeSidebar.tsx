import {
  LayoutDashboard,
  Package,
  PackageOpen,
  Box,
  Calculator,
  ShoppingCart,
  BarChart3,
  ListChecks,
  Settings,
  FileSearch,
  TrendingUp,
  CreditCard,
  Users,
  Percent,
  Contact,
  Plug,
  Receipt,
  Truck,
  FileText,
} from "lucide-react";
import { NavLink } from "@/components/NavLink";
import { useLocation } from "react-router-dom";
import { Link } from "react-router-dom";

import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";

const operationalItems = [
  { title: "Dashboard", url: "/admin", icon: LayoutDashboard },
  { title: "Intake", url: "/admin/intake", icon: PackageOpen },
  { title: "Inventory", url: "/admin/inventory", icon: Package },
  { title: "Products", url: "/admin/products", icon: Box },
  { title: "Listings", url: "/admin/listings", icon: ListChecks },
  { title: "Pricing", url: "/admin/pricing", icon: Calculator },
  { title: "Orders", url: "/admin/orders", icon: ShoppingCart },
  { title: "Customers", url: "/admin/customers", icon: Contact },
  { title: "Reconciliation", url: "/admin/reconciliation", icon: CreditCard },
  { title: "Demand", url: "/admin/demand", icon: TrendingUp },
  { title: "Analytics", url: "/admin/analytics", icon: BarChart3 },
  { title: "Audit Explorer", url: "/admin/audit", icon: FileSearch },
];

const settingsItems = [
  { title: "Content", url: "/admin/content", icon: FileText },
  { title: "Settings", url: "/admin/settings", icon: Settings },
  { title: "Integrations", url: "/admin/settings/integrations", icon: Plug },
  { title: "Selling Fees", url: "/admin/settings/selling-fees", icon: Receipt },
  { title: "Shipping Rates", url: "/admin/settings/shipping-rates", icon: Truck },
  { title: "Users", url: "/admin/settings/users", icon: Users },
  { title: "VAT Rates", url: "/admin/settings/vat-rates", icon: Percent },
];

export function BackOfficeSidebar() {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const location = useLocation();

  const isActive = (path: string) =>
    path === "/admin"
      ? location.pathname === "/admin"
      : location.pathname.startsWith(path);

  return (
    <Sidebar collapsible="icon" className="border-r-0">
      <SidebarContent>
        {/* Brand */}
        <div className="flex h-16 items-center border-b border-sidebar-border px-4">
          <Link to="/admin" className="flex items-center gap-2">
            {!collapsed && (
              <span className="font-display text-sm font-bold tracking-tight text-sidebar-foreground">
                KUSO<span className="text-sidebar-primary">.</span>OISHII
              </span>
            )}
            {collapsed && (
              <span className="font-display text-sm font-bold text-sidebar-primary">K</span>
            )}
          </Link>
        </div>

        {/* Operations */}
        <SidebarGroup>
          <SidebarGroupLabel className="font-display text-[10px] uppercase tracking-widest text-sidebar-foreground/50">
            Operations
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {operationalItems.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton
                    asChild
                    isActive={isActive(item.url)}
                    className="font-body text-sm"
                  >
                    <NavLink
                      to={item.url}
                      end={item.url === "/admin"}
                      className="hover:bg-sidebar-accent"
                      activeClassName="bg-sidebar-accent text-sidebar-primary font-medium"
                    >
                      <item.icon className="mr-2 h-4 w-4" />
                      {!collapsed && <span>{item.title}</span>}
                    </NavLink>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {/* Settings */}
        <SidebarGroup>
          <SidebarGroupLabel className="font-display text-[10px] uppercase tracking-widest text-sidebar-foreground/50">
            Admin
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {settingsItems.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton
                    asChild
                    isActive={isActive(item.url)}
                    className="font-body text-sm"
                  >
                    <NavLink
                      to={item.url}
                      className="hover:bg-sidebar-accent"
                      activeClassName="bg-sidebar-accent text-sidebar-primary font-medium"
                    >
                      <item.icon className="mr-2 h-4 w-4" />
                      {!collapsed && <span>{item.title}</span>}
                    </NavLink>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {/* Storefront link */}
        <div className="mt-auto border-t border-sidebar-border p-4">
          <Link
            to="/"
            className="font-body text-xs text-sidebar-foreground/50 hover:text-sidebar-foreground transition-colors"
          >
            {!collapsed && "← View Storefront"}
            {collapsed && "←"}
          </Link>
        </div>
      </SidebarContent>
    </Sidebar>
  );
}
