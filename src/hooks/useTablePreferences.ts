import { useState, useCallback, useEffect, useRef } from "react";
import type { SortDir, TablePrefs } from "@/lib/table-utils";

const STORAGE_PREFIX = "table-prefs-";

function loadPrefs(tableId: string, defaults: TablePrefs): TablePrefs {
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + tableId);
    if (!raw) return defaults;
    const stored = JSON.parse(raw) as Partial<TablePrefs>;

    // Merge: keep stored visible columns that still exist in defaults, add new defaults
    const allKeys = new Set(defaults.visibleColumns);
    const storedVisible = (stored.visibleColumns ?? []).filter((k: string) => allKeys.has(k) || defaults.visibleColumns.includes(k));
    // Add any new columns from defaults that weren't in stored
    const storedSet = new Set(storedVisible);
    for (const k of defaults.visibleColumns) {
      if (!storedSet.has(k)) storedVisible.push(k);
    }

    return {
      sort: stored.sort ?? defaults.sort,
      filters: { ...defaults.filters, ...(stored.filters ?? {}) },
      visibleColumns: storedVisible.length > 0 ? storedVisible : defaults.visibleColumns,
    };
  } catch {
    return defaults;
  }
}

export function useTablePreferences(tableId: string, defaultColumns: string[], defaultSort?: { key: string; dir: SortDir }) {
  const defaults: TablePrefs = {
    sort: defaultSort ?? { key: defaultColumns[0] ?? "", dir: "asc" },
    filters: {},
    visibleColumns: [...defaultColumns],
  };

  const [prefs, setPrefs] = useState<TablePrefs>(() => loadPrefs(tableId, defaults));
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  // Persist on change
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      localStorage.setItem(STORAGE_PREFIX + tableId, JSON.stringify(prefs));
    }, 300);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [prefs, tableId]);

  const toggleSort = useCallback((key: string) => {
    setPrefs((p) => ({
      ...p,
      sort: p.sort.key === key
        ? { key, dir: p.sort.dir === "asc" ? "desc" : "asc" }
        : { key, dir: "asc" },
    }));
  }, []);

  const setFilter = useCallback((key: string, value: string) => {
    setPrefs((p) => ({ ...p, filters: { ...p.filters, [key]: value } }));
  }, []);

  const toggleColumn = useCallback((key: string) => {
    setPrefs((p) => {
      const vis = p.visibleColumns.includes(key)
        ? p.visibleColumns.filter((k) => k !== key)
        : [...p.visibleColumns, key];
      return { ...p, visibleColumns: vis };
    });
  }, []);

  const moveColumn = useCallback((key: string, direction: "up" | "down") => {
    setPrefs((p) => {
      const cols = [...p.visibleColumns];
      const idx = cols.indexOf(key);
      if (idx < 0) return p;
      const targetIdx = direction === "up" ? idx - 1 : idx + 1;
      if (targetIdx < 0 || targetIdx >= cols.length) return p;
      [cols[idx], cols[targetIdx]] = [cols[targetIdx], cols[idx]];
      return { ...p, visibleColumns: cols };
    });
  }, []);

  return {
    prefs,
    toggleSort,
    setFilter,
    toggleColumn,
    moveColumn,
  };
}
