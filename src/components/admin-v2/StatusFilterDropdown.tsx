import type { OrderStatus } from "@/lib/types/admin";
import { MultiSelectFilter } from "./MultiSelectFilter";

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

const FILTER_OPTIONS = STATUS_OPTIONS.filter(
  (option): option is { value: OrderStatus; label: string } => Boolean(option.value),
);

/**
 * Status-specific column filter. Fixed-value status columns use exact-match
 * multi-select filters so operators can combine queues without text matching.
 */
export function StatusFilterDropdown({ value, onChange }: StatusFilterDropdownProps) {
  return <MultiSelectFilter value={value} onChange={onChange} options={FILTER_OPTIONS} placeholder="All statuses" />;
}
