export type SortDir = "asc" | "desc";

export interface ColumnDef<T> {
  key: string;
  label: string;
  align?: "left" | "center" | "right";
  defaultVisible?: boolean;
  sortable?: boolean;
  render: (row: T) => React.ReactNode;
}

export interface TablePrefs {
  sort: { key: string; dir: SortDir };
  filters: Record<string, string>;
  visibleColumns: string[];
}

export function sortRows<T>(rows: T[], key: string, dir: SortDir, accessor?: (row: T, key: string) => unknown): T[] {
  return [...rows].sort((a, b) => {
    const d = dir === "asc" ? 1 : -1;
    const av = accessor ? accessor(a, key) : (a as any)[key];
    const bv = accessor ? accessor(b, key) : (b as any)[key];
    if (av == null && bv == null) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;
    if (typeof av === "number" && typeof bv === "number") return (av - bv) * d;
    if (typeof av === "boolean" && typeof bv === "boolean") return (Number(av) - Number(bv)) * d;
    return String(av).localeCompare(String(bv)) * d;
  });
}
