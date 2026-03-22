import { Link, useLocation } from "react-router-dom";
import {
  ShoppingCart,
  Package,
  ClipboardList,
  Wallet,
  Zap,
  BarChart3,
  Settings,
} from "lucide-react";
import { cn } from "@/lib/utils";

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
    if (path === "/admin/v2/purchases") {
      return location.pathname === "/admin/v2/purchases" || location.pathname.startsWith("/admin/v2/purchases/");
    }
    if (path === "/admin/v2/products") {
      return location.pathname === "/admin/v2/products" || location.pathname.startsWith("/admin/v2/products/");
    }
    if (path === "/admin/v2/orders") {
      return location.pathname === "/admin/v2/orders" || location.pathname.startsWith("/admin/v2/orders/");
    }
    return location.pathname.startsWith(path);
  };

  return (
    <aside className="w-[220px] shrink-0 bg-[#18181B] border-r border-zinc-700/80 flex flex-col h-full">
      {/* Brand */}
      <div className="px-4 py-5 border-b border-zinc-700/80">
        <Link to="/admin/v2/purchases" className="flex items-center gap-2">
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
          to="/admin/v2/purchases"
          active={isActive("/admin/v2/purchases")}
          count={ungradedCount > 0 ? ungradedCount : undefined}
        />
        <SidebarItem
          icon={Package}
          label="Products"
          to="/admin/v2/products"
          active={isActive("/admin/v2/products")}
        />
        <SidebarItem
          icon={ClipboardList}
          label="Orders"
          to="/admin/v2/orders"
          active={isActive("/admin/v2/orders")}
          count={actionNeededCount > 0 ? actionNeededCount : undefined}
        />
        <SidebarItem
          icon={Wallet}
          label="Payouts"
          to="/admin/v2/payouts"
          active={isActive("/admin/v2/payouts")}
        />
      </div>

      {/* System */}
      <div className="py-3 border-b border-zinc-700/80">
        <div className="px-4 pb-2 text-[10px] text-zinc-500 font-semibold uppercase tracking-[0.08em]">
          System
        </div>
        <SidebarItem
          icon={Zap}
          label="QBO Sync"
          to="/admin/v2/qbo-sync"
          active={isActive("/admin/v2/qbo-sync")}
        />
        <SidebarItem
          icon={BarChart3}
          label="Analytics"
          to="/admin/v2/analytics"
          active={isActive("/admin/v2/analytics")}
        />
        <SidebarItem
          icon={Settings}
          label="Settings"
          to="/admin/v2/settings"
          active={isActive("/admin/v2/settings")}
        />
      </div>

      {/* Connection Status Footer */}
      <div className="mt-auto px-4 py-4 border-t border-zinc-700/80 space-y-1">
        <ConnectionIndicator label="QBO" connected />
        <ConnectionIndicator label="eBay" connected />
        <ConnectionIndicator label="Stripe" connected />
      </div>
    </aside>
  );
}

function ConnectionIndicator({ label, connected }: { label: string; connected: boolean }) {
  return (
    <div className="text-[11px] text-zinc-500">
      {label}:{" "}
      <span className={connected ? "text-green-500" : "text-red-500"}>
        {connected ? "●" : "●"} {connected ? "Connected" : "Disconnected"}
      </span>
    </div>
  );
}
