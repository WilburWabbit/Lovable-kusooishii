import { useMemo, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useCustomers } from "@/hooks/admin/use-customers";
import { useTablePreferences } from "@/hooks/useTablePreferences";
import { sortRows, filterRows } from "@/lib/table-utils";
import type { ColumnDef } from "@/lib/table-utils";
import type { CustomerRow } from "@/lib/types/admin";
import { ColumnSelector } from "@/components/admin/ColumnSelector";
import { SortableTableHead } from "@/components/admin/SortableTableHead";
import { SurfaceCard, Mono, Badge } from "./ui-primitives";
import { Download, Search } from "lucide-react";

// ─── Value accessor ──────────────────────────────────────────

function getValue(row: CustomerRow, key: string): unknown {
  switch (key) {
    case "channels":
      return Object.keys(row.channelIds).join(", ");
    default:
      return (row as Record<string, unknown>)[key];
  }
}

// ─── Column definitions ──────────────────────────────────────

const formatDate = (iso: string | null) => {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
};

const COLUMNS: ColumnDef<CustomerRow>[] = [
  {
    key: "name",
    label: "Name",
    defaultVisible: true,
    sortable: true,
    render: (r) => <span className="text-zinc-900 font-medium">{r.name}</span>,
  },
  {
    key: "email",
    label: "Email",
    defaultVisible: true,
    sortable: true,
    render: (r) => <span className="text-zinc-600">{r.email || "—"}</span>,
  },
  {
    key: "orderCount",
    label: "Orders",
    defaultVisible: true,
    sortable: true,
    align: "right",
    render: (r) => <Mono color={r.orderCount > 0 ? "default" : "dim"}>{r.orderCount}</Mono>,
  },
  {
    key: "totalSpend",
    label: "Total Spend",
    defaultVisible: true,
    sortable: true,
    align: "right",
    render: (r) => <Mono color="teal">£{r.totalSpend.toFixed(2)}</Mono>,
  },
  {
    key: "channels",
    label: "Channels",
    defaultVisible: true,
    sortable: false,
    render: (r) => {
      const keys = Object.keys(r.channelIds);
      return keys.length > 0 ? (
        <span className="text-zinc-600 text-xs">{keys.join(", ")}</span>
      ) : (
        <span className="text-zinc-400">—</span>
      );
    },
  },
  {
    key: "blueBellMember",
    label: "Blue Bell",
    defaultVisible: true,
    sortable: true,
    render: (r) =>
      r.blueBellMember ? (
        <Badge label="Member" color="#3B82F6" small />
      ) : (
        <span className="text-zinc-400">—</span>
      ),
  },
  {
    key: "active",
    label: "Active",
    defaultVisible: false,
    sortable: true,
    render: (r) =>
      r.active ? (
        <Badge label="Active" color="#22C55E" small />
      ) : (
        <Badge label="Inactive" color="#71717A" small />
      ),
  },
  {
    key: "phone",
    label: "Phone",
    defaultVisible: false,
    sortable: true,
    render: (r) => <span className="text-zinc-600">{r.phone ?? "—"}</span>,
  },
  {
    key: "mobile",
    label: "Mobile",
    defaultVisible: false,
    sortable: true,
    render: (r) => <span className="text-zinc-600">{r.mobile ?? "—"}</span>,
  },
  {
    key: "billingCity",
    label: "City",
    defaultVisible: false,
    sortable: true,
    render: (r) => <span className="text-zinc-600">{r.billingCity ?? "—"}</span>,
  },
  {
    key: "billingPostcode",
    label: "Postcode",
    defaultVisible: false,
    sortable: true,
    render: (r) => <Mono color="dim">{r.billingPostcode ?? "—"}</Mono>,
  },
  {
    key: "billingCountry",
    label: "Country",
    defaultVisible: false,
    sortable: true,
    render: (r) => <span className="text-zinc-600">{r.billingCountry ?? "—"}</span>,
  },
  {
    key: "qboCustomerId",
    label: "QBO ID",
    defaultVisible: false,
    sortable: false,
    render: (r) => <Mono color="dim">{r.qboCustomerId ?? "—"}</Mono>,
  },
  {
    key: "notes",
    label: "Notes",
    defaultVisible: false,
    sortable: false,
    render: (r) => (
      <span className="text-zinc-600 truncate max-w-[200px] block">
        {r.notes ?? "—"}
      </span>
    ),
  },
  {
    key: "createdAt",
    label: "Created",
    defaultVisible: false,
    sortable: true,
    render: (r) => <span className="text-zinc-500">{formatDate(r.createdAt)}</span>,
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

function downloadCsv(rows: CustomerRow[], visibleColumns: string[]) {
  const cols = visibleColumns.map((k) => COLUMN_MAP.get(k)).filter(Boolean) as ColumnDef<CustomerRow>[];
  const headers = cols.map((c) => csvEscape(c.label));

  const csvRows = rows.map((row) =>
    cols.map((c) => csvEscape(getValue(row, c.key))).join(","),
  );

  const csv = [headers.join(","), ...csvRows].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `customers-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ─── Component ───────────────────────────────────────────────

export function CustomerList() {
  const navigate = useNavigate();
  const { data: customers = [], isLoading } = useCustomers();
  const { prefs, toggleSort, setFilter, toggleColumn, moveColumn } = useTablePreferences(
    "v2-customers",
    DEFAULT_VISIBLE,
    { key: "name", dir: "asc" },
  );

  const globalSearch = prefs.filters._global ?? "";
  const setGlobalSearch = useCallback(
    (v: string) => setFilter("_global", v),
    [setFilter],
  );

  const processedRows = useMemo(() => {
    let result: CustomerRow[] = customers;

    if (globalSearch) {
      const term = globalSearch.toLowerCase();
      result = result.filter(
        (r) =>
          r.name.toLowerCase().includes(term) ||
          (r.email ?? "").toLowerCase().includes(term),
      );
    }

    const columnFilters = Object.fromEntries(
      Object.entries(prefs.filters).filter(([k]) => k !== "_global"),
    );
    result = filterRows(result, columnFilters, getValue);
    result = sortRows(result, prefs.sort.key, prefs.sort.dir, getValue);

    return result;
  }, [customers, globalSearch, prefs.filters, prefs.sort]);

  const visibleCols = prefs.visibleColumns
    .map((k) => COLUMN_MAP.get(k))
    .filter(Boolean) as ColumnDef<CustomerRow>[];

  if (isLoading) {
    return <p className="text-zinc-500 text-sm">Loading customers…</p>;
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <h1 className="text-[22px] font-bold text-zinc-900">Customers</h1>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-zinc-400" />
            <input
              value={globalSearch}
              onChange={(e) => setGlobalSearch(e.target.value)}
              placeholder="Search name or email…"
              className="pl-8 pr-3 py-1.5 text-[13px] border border-zinc-300 rounded-md bg-white text-zinc-900 w-56 focus:outline-none focus:ring-1 focus:ring-amber-500 focus:border-amber-500"
            />
          </div>
          <ColumnSelector
            allColumns={COLUMNS.map((c) => ({ key: c.key, label: c.label }))}
            visibleColumns={prefs.visibleColumns}
            onToggleColumn={toggleColumn}
            onMoveColumn={moveColumn}
          />
          <button
            onClick={() => downloadCsv(processedRows, prefs.visibleColumns)}
            className="h-9 px-3 gap-1.5 inline-flex items-center text-[13px] border border-zinc-300 rounded-md bg-white text-zinc-700 hover:bg-zinc-50 transition-colors cursor-pointer"
          >
            <Download className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">CSV</span>
          </button>
        </div>
      </div>
      <p className="text-zinc-500 text-[13px] mb-5">
        {processedRows.length} of {customers.length} customers
      </p>

      <SurfaceCard noPadding className="overflow-x-auto">
        <table className="w-full border-collapse text-[13px]">
          <thead>
            <tr className="border-b border-zinc-200">
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
            <tr className="border-b border-zinc-200 bg-zinc-50">
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
            {processedRows.map((row) => (
              <tr
                key={row.id}
                onClick={() => navigate(`/admin/v2/customers/${row.id}`)}
                className="border-b border-zinc-200 cursor-pointer hover:bg-zinc-50 transition-colors"
              >
                {visibleCols.map((col) => (
                  <td
                    key={col.key}
                    className={`px-3 py-2.5 ${col.align === "right" ? "text-right" : ""}`}
                  >
                    {col.render(row)}
                  </td>
                ))}
              </tr>
            ))}
            {processedRows.length === 0 && (
              <tr>
                <td
                  colSpan={visibleCols.length}
                  className="px-3 py-8 text-center text-zinc-500 text-sm"
                >
                  No customers match your filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </SurfaceCard>
    </div>
  );
}
