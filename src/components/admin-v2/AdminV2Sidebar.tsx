import type { ElementType } from "react";
import { Link, useLocation } from "react-router-dom";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useConnectionStatus } from "@/hooks/admin/use-connection-status";
import { adminSidebarSections, isAdminNavItemActive, type AdminNavCountKey } from "@/lib/admin-navigation";
import { adminSettingsGroups } from "@/lib/admin-settings-navigation";

interface SidebarItemProps {
  icon: ElementType;
  label: string;
  to: string;
  active: boolean;
  count?: number;
  onNavigate?: () => void;
}

function SidebarItem({ icon: Icon, label, to, active, count, onNavigate }: SidebarItemProps) {
  return (
    <Link
      to={to}
      onClick={onNavigate}
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

function isSettingsArea(pathname: string) {
  if (pathname === "/admin/settings") return true;
  return adminSettingsGroups.some((group) =>
    group.items.some((item) => pathname === item.to || pathname.startsWith(`${item.to}/`)),
  );
}

function isSettingsSubItemActive(pathname: string, to: string) {
  return pathname === to || pathname.startsWith(`${to}/`);
}

interface AdminV2SidebarProps {
  ungradedCount?: number;
  actionNeededCount?: number;
  mobileOpen?: boolean;
  onClose?: () => void;
}

export function AdminV2Sidebar({
  ungradedCount = 0,
  actionNeededCount = 0,
  mobileOpen = false,
  onClose,
}: AdminV2SidebarProps) {
  const location = useLocation();

  const countFor = (key?: AdminNavCountKey) => {
    if (key === "ungraded") return ungradedCount > 0 ? ungradedCount : undefined;
    if (key === "actionNeeded") return actionNeededCount > 0 ? actionNeededCount : undefined;
    return undefined;
  };

  return (
    <aside
      className={cn(
        "w-[220px] shrink-0 bg-[#18181B] border-r border-zinc-700/80 flex flex-col",
        // Mobile: fixed drawer with slide animation
        "fixed inset-y-0 left-0 z-50 transition-transform duration-200 ease-in-out",
        mobileOpen ? "translate-x-0" : "-translate-x-full",
        // Desktop: static, always visible
        "md:relative md:translate-x-0 md:h-full"
      )}
    >
      {/* Brand */}
      <div className="px-4 py-5 border-b border-zinc-700/80 flex items-center justify-between">
        <Link to="/admin/work-queue" className="flex items-center gap-2" onClick={onClose}>
          <div className="w-7 h-7 rounded-md bg-gradient-to-br from-amber-500 to-amber-600 flex items-center justify-center text-sm font-extrabold text-zinc-900">
            K
          </div>
          <div>
            <div className="text-sm font-bold text-zinc-50 leading-tight">Kuso Hub</div>
            <div className="text-[10px] text-zinc-500 tracking-wider uppercase">Operations</div>
          </div>
        </Link>
        {/* Close button — mobile only */}
        <button
          onClick={onClose}
          className="md:hidden text-zinc-500 hover:text-zinc-300 transition-colors"
          aria-label="Close menu"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {adminSidebarSections.map((section) => (
        <div key={section.label} className="py-3 border-b border-zinc-700/80">
          <div className="px-4 pb-2 text-[10px] text-zinc-500 font-semibold uppercase tracking-[0.08em]">
            {section.label}
          </div>
          {section.items.map((item) => {
            const active = isAdminNavItemActive(location.pathname, item);
            const showSettingsGroups = item.to === "/admin/settings" && isSettingsArea(location.pathname);

            return (
              <div key={item.to}>
                <SidebarItem
                  icon={item.icon}
                  label={item.label}
                  to={item.to}
                  active={active}
                  count={countFor(item.countKey)}
                  onNavigate={onClose}
                />
                {showSettingsGroups ? (
                  <div className="ml-4 mt-2 space-y-3 border-l border-zinc-700/80 pl-3">
                    {adminSettingsGroups.map((group) => (
                      <div key={group.title}>
                        <div className="mb-1 px-1 text-[9px] font-semibold uppercase tracking-[0.08em] text-zinc-600">
                          {group.title}
                        </div>
                        <div className="space-y-0.5">
                          {group.items.map((subItem) => {
                            const subActive = isSettingsSubItemActive(location.pathname, subItem.to);
                            return (
                              <Link
                                key={subItem.to}
                                to={subItem.to}
                                onClick={onClose}
                                className={cn(
                                  "flex items-center gap-2 rounded-md px-2 py-1.5 text-[12px] transition-colors",
                                  subActive
                                    ? "bg-zinc-800 text-amber-300"
                                    : "text-zinc-500 hover:bg-zinc-800/60 hover:text-zinc-300",
                                )}
                              >
                                <subItem.icon className="h-3.5 w-3.5 shrink-0 opacity-70" />
                                <span className="truncate">{subItem.label}</span>
                              </Link>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      ))}

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
