import type { ChangeEvent } from "react";

interface TableFilterInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
}

/**
 * Standard per-column filter input used across admin-v2 tables.
 * Supports the NULL / NOT NULL sentinel values handled by filterRows.
 *
 * Title text on the input documents the syntax for users.
 */
export function TableFilterInput({
  value,
  onChange,
  placeholder = "Filter…",
  className = "",
}: TableFilterInputProps) {
  return (
    <input
      value={value}
      onChange={(e: ChangeEvent<HTMLInputElement>) => onChange(e.target.value)}
      placeholder={placeholder}
      title="Type to filter. Use NULL to match empty values, NOT NULL (or !NULL) to exclude empty values."
      className={
        className ||
        "w-full px-1.5 py-1 text-[11px] font-normal border border-zinc-200 rounded bg-white text-zinc-700 focus:outline-none focus:ring-1 focus:ring-amber-500"
      }
    />
  );
}
