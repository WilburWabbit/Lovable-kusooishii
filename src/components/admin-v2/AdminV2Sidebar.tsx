import { Link, useLocation } from "react-router-dom";
import {
  ShoppingCart,
  Package,
  ClipboardList,
  Users,
  Wallet,
  Inbox,
  BarChart3,
  Settings,
  ArrowUpDown,
  Receipt,
  Truck,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useConnectionStatus } from "@/hooks/admin/use-connection-status";

interface SidebarItemProps {
  icon: React.ElementType;
  label: string;
  to: string;
  active: boolean;
  count?: number;
}

function SidebarItem({ icon: Icon, label, to, active, count }: SidebarItemProps) {
  return (
    <Link
      to={to}
      className={cn(
        "flex items-center gap-2.5 px-4 py-2.5 text-[13px] transition-colors border-l-2",
        active
          ? "border-amber-500 bg-amber-500/[0.07] text-zinc-50 font-semibold"
          : "border-transparent text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50"
      )}
    >
      <Icon className={cn("h-4 w-4 shrink-0", active ? "opacity-100" : "opacity-60")} />
      <span className="flex-1">{label}</span>
      {count !== undefined && count > 0 && (
        <span
          className={cn(
            "inline-flex items-center justify-center min-w-[20px] h-5 rounded-full px-1.5 text-[11px] font-bold",
            active
              ? "bg-amber-500 text-zinc-900"
              : "bg-zinc-700 text-zinc-400"
          )}
        >
          {count}
        </span>
      )}
    </Link>
  );
}

interface AdminV2SidebarProps {
  ungradedCount?: number;
  actionNeededCount?: number;
}

export function AdminV2Sidebar({ ungradedCount = 0, actionNeededCount = 0 }: AdminV2SidebarProps) {
  const location = useLocation();

  const isActive = (path: string) => {
    if (path === "/admin/purchases") {
      return location.pathname === "/admin/purchases" || location.pathname.startsWith("/admin/purchases/");
    }
    if (path === "/admin/products") {
      return location.pathname === "/admin/products" || location.pathname.startsWith("/admin/products/");
    }
    if (path === "/admin/orders") {
      return location.pathname === "/admin/orders" || location.pathname.startsWith("/admin/orders/");
    }
    if (path === "/admin/customers") {
      return location.pathname === "/admin/customers" || location.pathname.startsWith("/admin/customers/");
    }
    return location.pathname.startsWith(path);
  };

  return (
    <aside className="w-[220px] shrink-0 bg-[#18181B] border-r border-zinc-700/80 flex flex-col h-full">
      {/* Brand */}
      <div className="px-4 py-5 border-b border-zinc-700/80">
        <Link to="/admin/purchases" className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-md bg-gradient-to-br from-amber-500 to-amber-600 flex items-center justify-center text-sm font-extrabold text-zinc-900">
            K
          </div>
          <div>
            <div className="text-sm font-bold text-zinc-50 leading-tight">Kuso Hub</div>
            <div className="text-[10px] text-zinc-500 tracking-wider uppercase">Operations</div>
          </div>
        </Link>
      </div>

      {/* Pipeline */}
      <div className="py-3 border-b border-zinc-700/80">
        <div className="px-4 pb-2 text-[10px] text-zinc-500 font-semibold uppercase tracking-[0.08em]">
          Pipeline
        </div>
        <SidebarItem
          icon={ShoppingCart}
          label="Purchases"
          to="/admin/purchases"
          active={isActive("/admin/purchases")}
          count={ungradedCount > 0 ? ungradedCount : undefined}
        />
        <SidebarItem
          icon={Package}
          label="Products"
          to="/admin/products"
          active={isActive("/admin/products")}
        />
        <SidebarItem
          icon={ClipboardList}
          label="Orders"
          to="/admin/orders"
          active={isActive("/admin/orders")}
          count={actionNeededCount > 0 ? actionNeededCount : undefined}
        />
        <SidebarItem
          icon={Users}
          label="Customers"
          to="/admin/customers"
          active={isActive("/admin/customers")}
        />
        <SidebarItem
          icon={Wallet}
          label="Payouts"
          to="/admin/payouts"
          active={isActive("/admin/payouts")}
        />
      </div>

      {/* System */}
      <div className="py-3 border-b border-zinc-700/80">
        <div className="px-4 pb-2 text-[10px] text-zinc-500 font-semibold uppercase tracking-[0.08em]">
          System
        </div>
        <SidebarItem
          icon={Inbox}
          label="Intake"
          to="/admin/intake"
          active={isActive("/admin/intake")}
        />
        <SidebarItem
          icon={BarChart3}
          label="Analytics"
          to="/admin/analytics"
          active={isActive("/admin/analytics")}
        />
        <SidebarItem
          icon={ArrowUpDown}
          label="Data Sync"
          to="/admin/data-sync"
          active={isActive("/admin/data-sync")}
        />
        <SidebarItem
          icon={Settings}
          label="Settings"
          to="/admin/settings"
          active={isActive("/admin/settings")}
        />
      </div>

      {/* Connection Status Footer */}
      <ConnectionFooter />
    </aside>
  );
}

function ConnectionFooter() {
  const { data: status } = useConnectionStatus();

  const indicators: { label: string; state: string }[] = [
    { label: "QBO", state: status?.qbo ?? "disconnected" },
    { label: "eBay", state: status?.ebay ?? "disconnected" },
    { label: "Stripe", state: status?.stripe ?? "disconnected" },
  ];

  return (
    <div className="mt-auto px-4 py-4 border-t border-zinc-700/80 space-y-1">
      {indicators.map((i) => (
        <div key={i.label} className="text-[11px] text-zinc-500">
          {i.label}:{" "}
          <span
            className={
              i.state === "connected"
                ? "text-green-500"
                : i.state === "expired"
                ? "text-amber-500"
                : "text-red-500"
            }
          >
            ●{" "}
            {i.state === "connected"
              ? "Connected"
              : i.state === "expired"
              ? "Expired"
              : "Disconnected"}
          </span>
        </div>
      ))}
    </div>
  );
}
