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

/**
 * Returns true if a value is considered "null/empty" for filtering purposes:
 * null, undefined, empty string, empty array.
 */
function isNullish(val: unknown): boolean {
  if (val == null) return true;
  if (typeof val === "string" && val.trim() === "") return true;
  if (Array.isArray(val) && val.length === 0) return true;
  return false;
}

export function filterRows<T>(
  rows: T[],
  filters: Record<string, string>,
  accessor?: (row: T, key: string) => unknown,
): T[] {
  const active = Object.entries(filters).filter(([, v]) => v.length > 0);
  if (active.length === 0) return rows;
  return rows.filter((row) =>
    active.every(([key, term]) => {
      const val = accessor ? accessor(row, key) : (row as any)[key];
      const trimmed = term.trim();
      const upper = trimmed.toUpperCase();

      // Sentinel: NULL → field must be null/empty
      if (upper === "NULL") return isNullish(val);
      // Sentinel: NOT NULL or !NULL → field must have a value
      if (upper === "NOT NULL" || upper === "!NULL") return !isNullish(val);

      if (isNullish(val)) return false;
      return String(val).toLowerCase().includes(trimmed.toLowerCase());
    }),
  );
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
