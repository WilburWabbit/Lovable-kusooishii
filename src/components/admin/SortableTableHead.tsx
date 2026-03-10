import { TableHead } from "@/components/ui/table";
import { ArrowUp, ArrowDown, ArrowUpDown } from "lucide-react";
import type { SortDir } from "@/lib/table-utils";

interface Props {
  columnKey: string;
  label: string;
  sortKey: string;
  sortDir: SortDir;
  onToggleSort: (key: string) => void;
  align?: "left" | "center" | "right";
  sortable?: boolean;
  className?: string;
}

export function SortableTableHead({ columnKey, label, sortKey, sortDir, onToggleSort, align, sortable = true, className }: Props) {
  const alignClass = align === "right" ? "text-right" : align === "center" ? "text-center" : "";

  if (!sortable) {
    return <TableHead className={`${alignClass} ${className ?? ""}`}>{label}</TableHead>;
  }

  const isActive = sortKey === columnKey;

  return (
    <TableHead
      className={`cursor-pointer select-none ${alignClass} ${className ?? ""}`}
      onClick={() => onToggleSort(columnKey)}
    >
      {label}
      {isActive ? (
        sortDir === "asc" ? (
          <ArrowUp className="ml-1 inline h-3 w-3" />
        ) : (
          <ArrowDown className="ml-1 inline h-3 w-3" />
        )
      ) : (
        <ArrowUpDown className="ml-1 inline h-3 w-3 text-muted-foreground/50" />
      )}
    </TableHead>
  );
}
