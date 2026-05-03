import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { SurfaceCard } from "./ui-primitives";

interface AdminPageHeaderProps {
  title: string;
  description?: string;
  actions?: ReactNode;
  meta?: ReactNode;
}

export function AdminPageHeader({ title, description, actions, meta }: AdminPageHeaderProps) {
  return (
    <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0">
        <h1 className="text-[22px] font-bold text-zinc-900">{title}</h1>
        {description ? <p className="mt-1 max-w-3xl text-[13px] text-zinc-500">{description}</p> : null}
        {meta ? <div className="mt-2 flex flex-wrap items-center gap-2">{meta}</div> : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

interface AdminControlBarProps {
  children: ReactNode;
  className?: string;
}

export function AdminControlBar({ children, className }: AdminControlBarProps) {
  return (
    <div
      className={cn(
        "mb-4 flex flex-col gap-2 rounded-md border border-zinc-200 bg-white p-2 sm:flex-row sm:items-center sm:justify-between",
        className,
      )}
    >
      {children}
    </div>
  );
}

interface AdminDataTableProps {
  children: ReactNode;
  className?: string;
}

export function AdminDataTable({ children, className }: AdminDataTableProps) {
  return (
    <SurfaceCard noPadding className={cn("overflow-x-auto", className)}>
      {children}
    </SurfaceCard>
  );
}

interface AdminDetailTabsProps<T extends string> {
  tabs: Array<{ key: T; label: string; count?: number }>;
  activeTab: T;
  onChange: (key: T) => void;
}

export function AdminDetailTabs<T extends string>({ tabs, activeTab, onChange }: AdminDetailTabsProps<T>) {
  return (
    <div className="mb-5 flex gap-0 border-b border-zinc-200">
      {tabs.map((tab) => (
        <button
          key={tab.key}
          type="button"
          onClick={() => onChange(tab.key)}
          className={cn(
            "flex cursor-pointer items-center gap-1.5 border-b-2 bg-transparent px-4 py-2.5 text-[13px] transition-colors",
            activeTab === tab.key
              ? "border-amber-500 font-semibold text-zinc-900"
              : "border-transparent text-zinc-500 hover:text-zinc-700",
          )}
        >
          {tab.label}
          {tab.count !== undefined ? (
            <span className="rounded-full bg-zinc-200 px-1.5 py-px text-[11px] text-zinc-500">{tab.count}</span>
          ) : null}
        </button>
      ))}
    </div>
  );
}

interface AdminAuditPanelProps {
  title?: string;
  children: ReactNode;
}

export function AdminAuditPanel({ title = "Audit & Source Data", children }: AdminAuditPanelProps) {
  return (
    <SurfaceCard>
      <h3 className="mb-3 text-[11px] font-semibold uppercase tracking-[0.06em] text-zinc-500">{title}</h3>
      <div className="text-sm text-zinc-700">{children}</div>
    </SurfaceCard>
  );
}
