import { useMemo, useCallback, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useProducts, useProductStockCounts } from "@/hooks/admin/use-products";
import { useTablePreferences } from "@/hooks/useTablePreferences";
import { sortRows, filterRows } from "@/lib/table-utils";
import type { ColumnDef } from "@/lib/table-utils";
import type { Product, ProductVariant } from "@/lib/types/admin";
import type { ProductStockCounts } from "@/hooks/admin/use-products";
import { ColumnSelector } from "@/components/admin/ColumnSelector";
import { SortableTableHead } from "@/components/admin/SortableTableHead";
import { SurfaceCard, Mono, Badge, GradeBadge } from "./ui-primitives";
import { BulkCategoryAssignDialog } from "./BulkCategoryAssignDialog";
import { Download, Search, Tag } from "lucide-react";

// ─── Flattened row type ──────────────────────────────────────

interface ProductRow extends Product {
  variants: ProductVariant[];
  purchased: number;
  unlisted: number;
  unsold: number;
  onHand: number;
  sold: number;
}

// ─── Value accessor (for sort + filter) ──────────────────────

function getValue(row: ProductRow, key: string): unknown {
  switch (key) {
    case "variants":
      return row.variants.length;
    case "status":
      return row.variants.length === 0 ? "Ungraded" : `${row.variants.length} active`;
    default:
      return (row as unknown as Record<string, unknown>)[key];
  }
}

// ─── Column definitions ──────────────────────────────────────

const COLUMNS: ColumnDef<ProductRow>[] = [
  {
    key: "mpn",
    label: "MPN",
    defaultVisible: true,
    sortable: true,
    render: (r) => <Mono color="amber">{r.mpn}</Mono>,
  },
  {
    key: "name",
    label: "Product",
    defaultVisible: true,
    sortable: true,
    render: (r) => <span className="text-zinc-900 font-medium">{r.name}</span>,
  },
  {
    key: "theme",
    label: "Theme",
    defaultVisible: true,
    sortable: true,
    render: (r) => <span className="text-zinc-600">{r.theme ?? "—"}</span>,
  },
  {
    key: "variants",
    label: "Variants",
    defaultVisible: true,
    sortable: false,
    render: (r) => (
      <div className="flex gap-1">
        {r.variants.length > 0
          ? r.variants.map((v) => <GradeBadge key={v.sku} grade={v.grade} />)
          : <span className="text-zinc-500 text-xs">—</span>}
      </div>
    ),
  },
  {
    key: "purchased",
    label: "Purchased",
    defaultVisible: true,
    sortable: true,
    align: "right",
    render: (r) => <Mono>{r.purchased || "—"}</Mono>,
  },
  {
    key: "unlisted",
    label: "Unlisted",
    defaultVisible: true,
    sortable: true,
    align: "right",
    render: (r) => <Mono color={r.unlisted > 0 ? "amber" : "dim"}>{r.unlisted}</Mono>,
  },
  {
    key: "onHand",
    label: "On Hand",
    defaultVisible: true,
    sortable: true,
    align: "right",
    render: (r) => <Mono color={r.onHand > 0 ? "amber" : "dim"}>{r.onHand}</Mono>,
  },
  {
    key: "sold",
    label: "Sold",
    defaultVisible: true,
    sortable: true,
    align: "right",
    render: (r) => <Mono color={r.sold > 0 ? "green" : "dim"}>{r.sold}</Mono>,
  },
  {
    key: "status",
    label: "Status",
    defaultVisible: true,
    sortable: false,
    render: (r) =>
      r.variants.length === 0 ? (
        <Badge label="Ungraded" color="#F59E0B" small />
      ) : (
        <Badge label={`${r.variants.length} active`} color="#22C55E" small />
      ),
  },
  {
    key: "subtheme",
    label: "Subtheme",
    defaultVisible: false,
    sortable: true,
    render: (r) => <span className="text-zinc-600">{r.subtheme ?? "—"}</span>,
  },
  {
    key: "setNumber",
    label: "Set No.",
    defaultVisible: false,
    sortable: true,
    render: (r) => <Mono>{r.setNumber ?? "—"}</Mono>,
  },
  {
    key: "pieceCount",
    label: "Pieces",
    defaultVisible: false,
    sortable: true,
    align: "right",
    render: (r) => <Mono>{r.pieceCount ?? "—"}</Mono>,
  },
  {
    key: "ageMark",
    label: "Age",
    defaultVisible: false,
    sortable: true,
    render: (r) => <span className="text-zinc-600">{r.ageMark ?? "—"}</span>,
  },
  {
    key: "ean",
    label: "EAN",
    defaultVisible: false,
    sortable: true,
    render: (r) => <Mono>{r.ean ?? "—"}</Mono>,
  },
  {
    key: "releaseDate",
    label: "Released",
    defaultVisible: false,
    sortable: true,
    render: (r) => <span className="text-zinc-600">{r.releaseDate ?? "—"}</span>,
  },
  {
    key: "retiredDate",
    label: "Retired",
    defaultVisible: false,
    sortable: true,
    render: (r) => <span className="text-zinc-600">{r.retiredDate ?? "—"}</span>,
  },
  {
    key: "dimensionsCm",
    label: "Dimensions",
    defaultVisible: false,
    sortable: false,
    render: (r) => <span className="text-zinc-600">{r.dimensionsCm ?? "—"}</span>,
  },
  {
    key: "weightG",
    label: "Weight (g)",
    defaultVisible: false,
    sortable: true,
    align: "right",
    render: (r) => <Mono>{r.weightG ?? "—"}</Mono>,
  },
  {
    key: "createdAt",
    label: "Added",
    defaultVisible: false,
    sortable: true,
    render: (r) => (
      <span className="text-zinc-600">
        {new Date(r.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
      </span>
    ),
  },
];

const COLUMN_MAP = new Map(COLUMNS.map((c) => [c.key, c]));
const DEFAULT_VISIBLE = COLUMNS.filter((c) => c.defaultVisible).map((c) => c.key);

// ─── CSV export ──────────────────────────────────────────────

function csvEscape(value: unknown): string {
  const s = value == null ? "" : String(value);
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function downloadCsv(rows: ProductRow[], visibleColumns: string[]) {
  const cols = visibleColumns.map((k) => COLUMN_MAP.get(k)).filter(Boolean) as ColumnDef<ProductRow>[];
  const headers = cols.map((c) => csvEscape(c.label));

  const csvRows = rows.map((row) =>
    cols.map((c) => {
      const val = getValue(row, c.key);
      if (c.key === "variants") return row.variants.map((v) => `G${v.grade}`).join(" ");
      return csvEscape(val);
    }).join(","),
  );

  const csv = [headers.join(","), ...csvRows].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `products-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ─── Component ───────────────────────────────────────────────

export function ProductList() {
  const navigate = useNavigate();
  const { data: products = [], isLoading } = useProducts();
  const { data: stockCounts } = useProductStockCounts();
  const { prefs, toggleSort, setFilter, toggleColumn, moveColumn } = useTablePreferences(
    "v2-products",
    DEFAULT_VISIBLE,
    { key: "name", dir: "asc" },
  );

  // Selection state for bulk operations
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkOpen, setBulkOpen] = useState(false);

  const toggleRow = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  // Build flattened rows
  const rows: ProductRow[] = useMemo(() => {
    return products.map((p) => {
      const counts: ProductStockCounts = stockCounts?.get(p.mpn) ?? { purchased: 0, unlisted: 0, unsold: 0, onHand: 0, sold: 0 };
      return { ...p, ...counts };
    });
  }, [products, stockCounts]);

  // Global search — filters across mpn + name
  const globalSearch = prefs.filters._global ?? "";
  const setGlobalSearch = useCallback(
    (v: string) => setFilter("_global", v),
    [setFilter],
  );

  // Apply filters then sort
  const processedRows = useMemo(() => {
    let result = rows;

    // Global search
    if (globalSearch) {
      const term = globalSearch.toLowerCase();
      result = result.filter(
        (r) => r.mpn.toLowerCase().includes(term) || r.name.toLowerCase().includes(term),
      );
    }

    // Per-column filters (exclude _global)
    const columnFilters = Object.fromEntries(
      Object.entries(prefs.filters).filter(([k]) => k !== "_global"),
    );
    result = filterRows(result, columnFilters, getValue);

    // Sort
    result = sortRows(result, prefs.sort.key, prefs.sort.dir, getValue);

    return result;
  }, [rows, globalSearch, prefs.filters, prefs.sort]);

  const visibleIds = useMemo(() => processedRows.map((r) => r.id), [processedRows]);
  const allVisibleSelected =
    visibleIds.length > 0 && visibleIds.every((id) => selected.has(id));
  const someVisibleSelected =
    !allVisibleSelected && visibleIds.some((id) => selected.has(id));

  const toggleAllVisible = useCallback(() => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allVisibleSelected) {
        for (const id of visibleIds) next.delete(id);
      } else {
        for (const id of visibleIds) next.add(id);
      }
      return next;
    });
  }, [allVisibleSelected, visibleIds]);

  // Visible column defs in order
  const visibleCols = prefs.visibleColumns
    .map((k) => COLUMN_MAP.get(k))
    .filter(Boolean) as ColumnDef<ProductRow>[];

  if (isLoading) {
    return <p className="text-zinc-500 text-sm">Loading products…</p>;
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <h1 className="text-[22px] font-bold text-zinc-900">Products</h1>
        <div className="flex items-center gap-2">
          {/* Global search */}
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-zinc-400" />
            <input
              value={globalSearch}
              onChange={(e) => setGlobalSearch(e.target.value)}
              placeholder="Search MPN or name…"
              className="pl-8 pr-3 py-1.5 text-[13px] border border-zinc-300 rounded-md bg-white text-zinc-900 w-56 focus:outline-none focus:ring-1 focus:ring-amber-500 focus:border-amber-500"
            />
          </div>
          {/* Column selector */}
          <ColumnSelector
            allColumns={COLUMNS.map((c) => ({ key: c.key, label: c.label }))}
            visibleColumns={prefs.visibleColumns}
            onToggleColumn={toggleColumn}
            onMoveColumn={moveColumn}
          />
          {/* CSV export */}
          <button
            onClick={() => downloadCsv(processedRows, prefs.visibleColumns)}
            className="h-9 px-3 gap-1.5 inline-flex items-center text-[13px] border border-zinc-300 rounded-md bg-white text-zinc-700 hover:bg-zinc-50 transition-colors cursor-pointer"
          >
            <Download className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">CSV</span>
          </button>
        </div>
      </div>
      <div className="flex items-center justify-between mb-5">
        <p className="text-zinc-500 text-[13px]">
          {processedRows.length} of {products.length} products
          {selected.size > 0 && (
            <>
              {" · "}
              <span className="text-amber-700 font-medium">
                {selected.size} selected
              </span>
              {" · "}
              <button
                onClick={() => setSelected(new Set())}
                className="text-zinc-500 hover:text-zinc-700 underline"
              >
                Clear
              </button>
            </>
          )}
        </p>
        {selected.size > 0 && (
          <button
            onClick={() => setBulkOpen(true)}
            className="h-9 px-3 gap-1.5 inline-flex items-center text-[13px] font-medium border border-amber-300 rounded-md bg-amber-50 text-amber-700 hover:bg-amber-100 transition-colors cursor-pointer"
          >
            <Tag className="h-3.5 w-3.5" />
            Set eBay category ({selected.size})
          </button>
        )}
      </div>

      <SurfaceCard noPadding className="overflow-x-auto">
        <table className="w-full border-collapse text-[13px]">
          <thead>
            {/* Sort headers */}
            <tr className="border-b border-zinc-200">
              <th className="px-3 py-2.5 w-8">
                <input
                  type="checkbox"
                  checked={allVisibleSelected}
                  ref={(el) => {
                    if (el) el.indeterminate = someVisibleSelected;
                  }}
                  onChange={toggleAllVisible}
                  className="accent-amber-500 cursor-pointer"
                  aria-label="Select all visible"
                />
              </th>
              {visibleCols.map((col) => (
                <SortableTableHead
                  key={col.key}
                  columnKey={col.key}
                  label={col.label}
                  sortKey={prefs.sort.key}
                  sortDir={prefs.sort.dir}
                  onToggleSort={toggleSort}
                  sortable={col.sortable}
                  align={col.align}
                  className="px-3 py-2.5 text-[10px] uppercase tracking-wider font-medium"
                />
              ))}
            </tr>
            {/* Filter row */}
            <tr className="border-b border-zinc-200 bg-zinc-50">
              <th className="px-3 py-1" />
              {visibleCols.map((col) => (
                <th key={col.key} className="px-3 py-1">
                  {col.sortable !== false ? (
                    <input
                      value={prefs.filters[col.key] ?? ""}
                      onChange={(e) => setFilter(col.key, e.target.value)}
                      placeholder="Filter…"
                      className="w-full px-1.5 py-1 text-[11px] font-normal border border-zinc-200 rounded bg-white text-zinc-700 focus:outline-none focus:ring-1 focus:ring-amber-500"
                    />
                  ) : (
                    <span />
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {processedRows.map((row) => {
              const isSelected = selected.has(row.id);
              return (
                <tr
                  key={row.mpn}
                  onClick={() => navigate(`/admin/products/${row.mpn}`)}
                  className={`border-b border-zinc-200 cursor-pointer transition-colors ${
                    isSelected ? "bg-amber-50/50 hover:bg-amber-50" : "hover:bg-zinc-50"
                  }`}
                >
                  <td
                    className="px-3 py-2.5 w-8"
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleRow(row.id);
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => toggleRow(row.id)}
                      onClick={(e) => e.stopPropagation()}
                      className="accent-amber-500 cursor-pointer"
                      aria-label={`Select ${row.mpn}`}
                    />
                  </td>
                  {visibleCols.map((col) => (
                    <td
                      key={col.key}
                      className={`px-3 py-2.5 ${col.align === "right" ? "text-right" : ""}`}
                    >
                      {col.render(row)}
                    </td>
                  ))}
                </tr>
              );
            })}
            {processedRows.length === 0 && (
              <tr>
                <td
                  colSpan={visibleCols.length + 1}
                  className="px-3 py-8 text-center text-zinc-500 text-sm"
                >
                  No products match your filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </SurfaceCard>

      <BulkCategoryAssignDialog
        open={bulkOpen}
        onClose={() => setBulkOpen(false)}
        productIds={Array.from(selected)}
      />
    </div>
  );
}
