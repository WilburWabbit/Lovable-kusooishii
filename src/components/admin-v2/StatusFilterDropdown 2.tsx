import { ChevronDown } from "lucide-react";
import type { OrderStatus } from "@/lib/types/admin";

interface StatusFilterDropdownProps {
  value: string;
  onChange: (value: string) => void;
}

const STATUS_OPTIONS: { value: OrderStatus | ""; label: string }[] = [
  { value: "", label: "All statuses" },
  { value: "needs_allocation", label: "Needs allocation" },
  { value: "new", label: "New" },
  { value: "awaiting_shipment", label: "Awaiting shipment" },
  { value: "shipped", label: "Shipped" },
  { value: "delivered", label: "Delivered" },
  { value: "complete", label: "Complete" },
  { value: "return_pending", label: "Return pending" },
  { value: "refunded", label: "Refunded" },
  { value: "cancelled", label: "Cancelled" },
];

/**
 * Status-specific column filter. Renders a native <select> styled to match
 * TableFilterInput. Writes the selected enum value (or empty string) into
 * the column's filter slot — filterRows substring-matches it against the
 * row's status string.
 */
export function StatusFilterDropdown({ value, onChange }: StatusFilterDropdownProps) {
  return (
    <div className="relative w-full">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full pl-1.5 pr-5 py-1 text-[11px] font-normal border border-zinc-200 rounded bg-white text-zinc-700 focus:outline-none focus:ring-1 focus:ring-amber-500 appearance-none cursor-pointer"
      >
        {STATUS_OPTIONS.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
      <ChevronDown className="absolute right-1 top-1/2 -translate-y-1/2 h-3 w-3 text-zinc-400 pointer-events-none" />
    </div>
  );
}
