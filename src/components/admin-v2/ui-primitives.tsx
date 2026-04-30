import { forwardRef } from "react";
import { cn } from "@/lib/utils";
import type { StockUnitStatus, OrderStatus, ConditionGrade } from "@/lib/types/admin";
import { UNIT_STATUSES, ORDER_STATUSES, GRADE_COLORS } from "@/lib/constants/unit-statuses";

// ─── Mono (JetBrains Mono data text) ────────────────────────

interface MonoProps {
  children: React.ReactNode;
  className?: string;
  color?: "amber" | "teal" | "dim" | "default" | "green" | "red";
}

const colorMap: Record<string, string> = {
  amber: "text-amber-500",
  teal: "text-teal-500",
  dim: "text-zinc-500",
  default: "text-zinc-600",
  green: "text-green-500",
  red: "text-red-500",
};

export const Mono = forwardRef<HTMLSpanElement, MonoProps>(
  ({ children, className, color = "default" }, ref) => {
    return (
      <span
        ref={ref}
        className={cn("font-mono text-xs tracking-wide", colorMap[color], className)}
      >
        {children}
      </span>
    );
  }
);
Mono.displayName = "Mono";

// ─── Badge ──────────────────────────────────────────────────

interface BadgeProps {
  label: string;
  color: string;
  small?: boolean;
}

export function Badge({ label, color, small }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-block rounded font-semibold uppercase tracking-wide border",
        small ? "px-1.5 py-px text-[10px]" : "px-2.5 py-0.5 text-[11px]"
      )}
      style={{
        background: `${color}18`,
        color,
        borderColor: `${color}30`,
      }}
    >
      {label}
    </span>
  );
}

// ─── StatusBadge ────────────────────────────────────────────

export function StatusBadge({ status }: { status: StockUnitStatus }) {
  const s = UNIT_STATUSES[status] ?? { label: status, color: "#71717A" };
  return <Badge label={s.label} color={s.color} small />;
}

// ─── OrderStatusBadge ───────────────────────────────────────

export function OrderStatusBadge({ status, itemCount = 1 }: { status: OrderStatus; itemCount?: number }) {
  if (status === "needs_allocation" && itemCount === 0) {
    return <Badge label="Draft" color="#F97316" small />;
  }
  const s = ORDER_STATUSES[status] ?? { label: status, color: "#71717A" };
  return <Badge label={s.label} color={s.color} small />;
}

// ─── GradeBadge ─────────────────────────────────────────────

interface GradeBadgeProps {
  grade: ConditionGrade | number;
  size?: "sm" | "md";
}

export function GradeBadge({ grade, size = "sm" }: GradeBadgeProps) {
  const color = GRADE_COLORS[grade as ConditionGrade] ?? "#71717A";
  return (
    <span
      className={cn(
        "inline-flex items-center justify-center rounded font-mono font-extrabold border",
        size === "sm" ? "w-5 h-5 text-[10px]" : "w-[26px] h-[26px] text-xs"
      )}
      style={{
        background: `${color}20`,
        color,
        borderColor: `${color}30`,
      }}
    >
      G{grade}
    </span>
  );
}

// ─── SurfaceCard ────────────────────────────────────────────

interface SurfaceCardProps {
  children: React.ReactNode;
  className?: string;
  onClick?: () => void;
  noPadding?: boolean;
}

export function SurfaceCard({ children, className, onClick, noPadding }: SurfaceCardProps) {
  return (
    <div
      onClick={onClick}
      className={cn(
        "bg-white border border-zinc-200 rounded-lg shadow-sm transition-all",
        onClick && "cursor-pointer hover:border-amber-500/40 hover:-translate-y-px",
        !noPadding && "p-4",
        className
      )}
    >
      {children}
    </div>
  );
}

// ─── SummaryCard ────────────────────────────────────────────

interface SummaryCardProps {
  label: string;
  value: string | number;
  color?: string;
}

export function SummaryCard({ label, value, color = "#18181B" }: SummaryCardProps) {
  return (
    <SurfaceCard className="p-3">
      <div className="text-[11px] text-zinc-500 mb-1">{label}</div>
      <div className="font-mono text-xl font-bold" style={{ color }}>
        {value}
      </div>
    </SurfaceCard>
  );
}

// ─── SectionHead ────────────────────────────────────────────

export const SectionHead = forwardRef<
  HTMLHeadingElement,
  { children: React.ReactNode }
>(function SectionHead({ children }, ref) {
  return (
    <h3
      ref={ref}
      className="text-[11px] text-zinc-500 font-semibold uppercase tracking-[0.06em] mb-3"
    >
      {children}
    </h3>
  );
});

// ─── BackButton ─────────────────────────────────────────────

interface BackButtonProps {
  onClick: () => void;
  label?: string;
}

export function BackButton({ onClick, label = "Back" }: BackButtonProps) {
  return (
    <button
      onClick={onClick}
      className="text-zinc-500 text-[13px] mb-3 flex items-center gap-1 hover:text-zinc-700 transition-colors bg-transparent border-none cursor-pointer p-0"
    >
      ← {label}
    </button>
  );
}

// ─── Unit Lifecycle Stepper ─────────────────────────────────

const LIFECYCLE_STEPS = [
  "Purchased", "Graded", "Listed", "Sold", "Shipped", "Delivered", "Payout Received", "Complete",
] as const;

const STATUS_ORDER: StockUnitStatus[] = [
  "purchased", "graded", "listed", "sold", "shipped", "delivered", "payout_received", "complete",
];

export function UnitLifecycle({ status }: { status: StockUnitStatus }) {
  const currentIdx = STATUS_ORDER.indexOf(status);
  const isReturn = status === "return_pending" || status === "refunded";

  return (
    <div className="grid gap-0.5">
      {LIFECYCLE_STEPS.map((step, i) => {
        const done = i <= currentIdx && !isReturn;
        const active = i === currentIdx && !isReturn;
        return (
          <div key={step} className="flex items-center gap-2.5 py-1">
            <div
              className={cn(
                "w-[18px] h-[18px] rounded-full flex items-center justify-center text-[9px] font-bold border-2",
                done
                  ? "bg-green-500/10 border-green-500 text-green-500"
                  : active
                  ? "bg-amber-500/10 border-amber-500 text-amber-500"
                  : "bg-zinc-200 border-zinc-300 text-zinc-400"
              )}
            >
              {done ? "✓" : ""}
            </div>
            <span
              className={cn(
                "text-xs",
                done ? "text-zinc-900" : active ? "text-amber-600 font-semibold" : "text-zinc-400"
              )}
            >
              {step}
            </span>
          </div>
        );
      })}
      {isReturn && (
        <div className="flex items-center gap-2.5 py-1 mt-1 border-t border-red-500/20">
          <div className="w-[18px] h-[18px] rounded-full flex items-center justify-center text-[9px] font-bold border-2 bg-red-500/10 border-red-500 text-red-500">
            !
          </div>
          <span className="text-xs text-red-500 font-semibold">
            {status === "return_pending" ? "Return Pending" : "Refunded"}
          </span>
        </div>
      )}
    </div>
  );
}
