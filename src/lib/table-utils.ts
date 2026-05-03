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

const MULTI_FILTER_PREFIX = "__multi__:";

export function encodeMultiFilter(values: string[]): string {
  const clean = Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
  return clean.length > 0 ? `${MULTI_FILTER_PREFIX}${clean.join("||")}` : "";
}

export function decodeMultiFilter(value: string): string[] {
  if (!value.startsWith(MULTI_FILTER_PREFIX)) return [];
  return value
    .slice(MULTI_FILTER_PREFIX.length)
    .split("||")
    .map((item) => item.trim())
    .filter(Boolean);
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
      const val = accessor ? accessor(row, key) : (row as Record<string, unknown>)[key];
      const trimmed = term.trim();
      const upper = trimmed.toUpperCase();
      const multiValues = decodeMultiFilter(trimmed);

      if (multiValues.length > 0) {
        if (isNullish(val)) return false;
        const candidates = Array.isArray(val) ? val : [val];
        const normalizedValues = new Set(multiValues.map((item) => item.toLowerCase()));
        return candidates.some((candidate) => normalizedValues.has(String(candidate).toLowerCase()));
      }

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
    const av = accessor ? accessor(a, key) : (a as Record<string, unknown>)[key];
    const bv = accessor ? accessor(b, key) : (b as Record<string, unknown>)[key];
    if (av == null && bv == null) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;
    if (typeof av === "number" && typeof bv === "number") return (av - bv) * d;
    if (typeof av === "boolean" && typeof bv === "boolean") return (Number(av) - Number(bv)) * d;
    return String(av).localeCompare(String(bv)) * d;
  });
}
