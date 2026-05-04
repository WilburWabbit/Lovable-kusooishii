import { Check, ChevronDown } from "lucide-react";
import { decodeMultiFilter, encodeMultiFilter } from "@/lib/table-utils";
import { cn } from "@/lib/utils";

export interface MultiSelectFilterOption {
  value: string;
  label: string;
}

interface MultiSelectFilterProps {
  value: string;
  onChange: (value: string) => void;
  options: MultiSelectFilterOption[];
  placeholder?: string;
}

export function MultiSelectFilter({
  value,
  onChange,
  options,
  placeholder = "All",
}: MultiSelectFilterProps) {
  const selected = decodeMultiFilter(value);
  const selectedSet = new Set(selected);
  const label =
    selected.length === 0
      ? placeholder
      : selected.length === 1
        ? options.find((option) => option.value === selected[0])?.label ?? selected[0]
        : `${selected.length} selected`;

  const toggle = (optionValue: string) => {
    const next = selectedSet.has(optionValue)
      ? selected.filter((item) => item !== optionValue)
      : [...selected, optionValue];
    onChange(encodeMultiFilter(next));
  };

  return (
    <div className="group relative w-full">
      <button
        type="button"
        className="flex w-full items-center justify-between rounded border border-zinc-200 bg-white py-1 pl-1.5 pr-1 text-left text-[11px] font-normal text-zinc-700 focus:outline-none focus:ring-1 focus:ring-amber-500"
      >
        <span className={cn("truncate", selected.length === 0 && "text-zinc-400")}>{label}</span>
        <ChevronDown className="ml-1 h-3 w-3 shrink-0 text-zinc-400" />
      </button>
      <div className="invisible absolute left-0 top-[calc(100%+2px)] z-30 min-w-full rounded-md border border-zinc-200 bg-white p-1 opacity-0 shadow-lg transition group-focus-within:visible group-focus-within:opacity-100 group-hover:visible group-hover:opacity-100">
        <button
          type="button"
          onClick={() => onChange("")}
          className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[11px] text-zinc-500 hover:bg-zinc-50"
        >
          <span className="h-3 w-3" />
          {placeholder}
        </button>
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            onClick={() => toggle(option.value)}
            className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[11px] text-zinc-700 hover:bg-zinc-50"
          >
            <span className="flex h-3 w-3 items-center justify-center">
              {selectedSet.has(option.value) ? <Check className="h-3 w-3 text-amber-600" /> : null}
            </span>
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}
