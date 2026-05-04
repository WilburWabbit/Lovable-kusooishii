import { useState, useCallback, useMemo } from "react";
import { filterRows, sortRows, type SortDir } from "@/lib/table-utils";

/**
 * Lightweight in-memory filter+sort state for tables that don't need
 * the full useTablePreferences (no localStorage persistence, no column
 * visibility). Supports the same NULL / NOT NULL filter sentinels.
 */
export function useSimpleTableFilters<T>(
  rows: T[],
  options: {
    accessor?: (row: T, key: string) => unknown;
    initialSort?: { key: string; dir: SortDir };
  } = {},
) {
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [sort, setSort] = useState<{ key: string; dir: SortDir } | null>(
    options.initialSort ?? null,
  );

  const setFilter = useCallback((key: string, value: string) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
  }, []);

  const toggleSort = useCallback((key: string) => {
    setSort((prev) => {
      if (!prev || prev.key !== key) return { key, dir: "asc" };
      return { key, dir: prev.dir === "asc" ? "desc" : "asc" };
    });
  }, []);

  const clearFilters = useCallback(() => setFilters({}), []);

  const processedRows = useMemo(() => {
    let result = filterRows(rows, filters, options.accessor);
    if (sort) result = sortRows(result, sort.key, sort.dir, options.accessor);
    return result;
  }, [rows, filters, sort, options.accessor]);

  return { filters, setFilter, sort, toggleSort, clearFilters, processedRows };
}
