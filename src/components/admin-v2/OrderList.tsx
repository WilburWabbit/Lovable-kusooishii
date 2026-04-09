import { useState, useMemo, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useOrders } from "@/hooks/admin/use-orders";
import { useTablePreferences } from "@/hooks/useTablePreferences";
import { sortRows, filterRows } from "@/lib/table-utils";
import type { ColumnDef } from "@/lib/table-utils";
import type { OrderDetail } from "@/lib/types/admin";
import { ColumnSelector } from "@/components/admin/ColumnSelector";
import { SortableTableHead } from "@/components/admin/SortableTableHead";
import { SurfaceCard, Mono, OrderStatusBadge, Badge } from "./ui-primitives";
import { CashSaleForm } from "./CashSaleForm";
import { CompleteOrderModal } from "./CompleteOrderModal";
import { Download, Search } from "lucide-react";

// ─── Row type ────────────────────────────────────────────────

type OrderRow = OrderDetail;

// ─── Value accessor (for sort + filter) ──────────────────────

function getValue(row: OrderRow, key: string): unknown {
  switch (key) {
    case "customerName":
      return row.customer?.name ?? "Cash Sales";
    case "items":
      return row.lineItems.length;
    case "ref":
      return row.externalOrderId || row.docNumber || row.orderNumber;
    default:
      return (row as unknown as Record<string, unknown>)[key];
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

const COLUMNS: ColumnDef<OrderRow>[] = [
  {
    key: "ref",
    label: "Ref",
    defaultVisible: true,
    sortable: true,
    render: (r) => {
      const ref = r.externalOrderId || r.docNumber || r.orderNumber;
      const isInternal = !r.externalOrderId && !r.docNumber;
      return <Mono color={isInternal ? "dim" : "amber"}>{ref}</Mono>;
    },
  },
  {
    key: "orderNumber",
    label: "Internal ID",
    defaultVisible: false,
    sortable: true,
    render: (r) => <Mono color="dim">{r.orderNumber}</Mono>,
  },
  {
    key: "customerName",
    label: "Customer",
    defaultVisible: true,
    sortable: true,
    render: (r) => {
      const name = r.customer?.name ?? "Cash Sales";
      const isCash = !r.customer || name === "Cash Sales";
      return (
        <span className="text-zinc-900">
          {name}
          {isCash && r.status === "needs_allocation" && (
            <span className="text-[10px] text-amber-500 ml-1.5">
              ⚠ {r.lineItems.length === 0 ? "Add items" : "Allocate"}
            </span>
          )}
        </span>
      );
    },
  },
  {
    key: "channel",
    label: "Channel",
    defaultVisible: true,
    sortable: true,
    render: (r) => {
      const label = r.channel === "squarespace" ? "Square Space" : r.channel;
      return <span className="text-zinc-600">{label}</span>;
    },
  },
  {
    key: "items",
    label: "Items",
    defaultVisible: true,
    sortable: true,
    align: "right",
    render: (r) => {
      const firstName = r.lineItems[0]?.name;
      const count = r.lineItems.length;
      return (
        <span className="text-zinc-600">
          {firstName ? (
            <span title={firstName}>
              {firstName.length > 24 ? firstName.slice(0, 24) + "…" : firstName}
              {count > 1 && <span className="text-zinc-400 ml-1">+{count - 1}</span>}
            </span>
          ) : (
            count
          )}
        </span>
      );
    },
  },
  {
    key: "total",
    label: "Total",
    defaultVisible: true,
    sortable: true,
    align: "right",
    render: (r) => <Mono color="teal">£{r.total.toFixed(2)}</Mono>,
  },
  {
    key: "vatAmount",
    label: "VAT",
    defaultVisible: true,
    sortable: true,
    align: "right",
    render: (r) => <Mono color="dim">£{r.vatAmount.toFixed(2)}</Mono>,
  },
  {
    key: "netAmount",
    label: "Net",
    defaultVisible: false,
    sortable: true,
    align: "right",
    render: (r) => <Mono>£{r.netAmount.toFixed(2)}</Mono>,
  },
  {
    key: "status",
    label: "Status",
    defaultVisible: true,
    sortable: false,
    render: (r) => <OrderStatusBadge status={r.status} itemCount={r.lineItems.length} />,
  },
  {
    key: "createdAt",
    label: "Date",
    defaultVisible: true,
    sortable: true,
    render: (r) => <span className="text-zinc-500">{formatDate(r.createdAt)}</span>,
  },
  {
    key: "paymentMethod",
    label: "Payment",
    defaultVisible: false,
    sortable: true,
    render: (r) => <span className="text-zinc-600">{r.paymentMethod ?? "—"}</span>,
  },
  {
    key: "carrier",
    label: "Carrier",
    defaultVisible: false,
    sortable: true,
    render: (r) => <span className="text-zinc-600">{r.carrier ?? "—"}</span>,
  },
  {
    key: "trackingNumber",
    label: "Tracking",
    defaultVisible: false,
    sortable: false,
    render: (r) => <Mono color="dim">{r.trackingNumber ?? "—"}</Mono>,
  },
  {
    key: "shippingCost",
    label: "Shipping",
    defaultVisible: false,
    sortable: true,
    align: "right",
    render: (r) =>
      r.shippingCost != null ? (
        <Mono>£{r.shippingCost.toFixed(2)}</Mono>
      ) : (
        <span className="text-zinc-400">—</span>
      ),
  },
  {
    key: "blueBellClub",
    label: "Blue Bell",
    defaultVisible: false,
    sortable: true,
    render: (r) =>
      r.blueBellClub ? (
        <Badge label="Yes" color="#3B82F6" small />
      ) : (
        <span className="text-zinc-400">—</span>
      ),
  },
  {
    key: "qboSyncStatus",
    label: "QBO",
    defaultVisible: false,
    sortable: false,
    render: (r) => {
      const color =
        r.qboSyncStatus === "synced"
          ? "#22C55E"
          : r.qboSyncStatus === "error"
          ? "#EF4444"
          : "#F59E0B";
      const label =
        r.qboSyncStatus === "synced"
          ? "Synced"
          : r.qboSyncStatus === "error"
          ? "Error"
          : "Pending";
      return <Badge label={label} color={color} small />;
    },
  },
  {
    key: "docNumber",
    label: "QBO Doc",
    defaultVisible: false,
    sortable: true,
    render: (r) => <Mono color="dim">{r.docNumber ?? "—"}</Mono>,
  },
  {
    key: "shippedAt",
    label: "Shipped",
    defaultVisible: false,
    sortable: true,
    render: (r) => <span className="text-zinc-500">{formatDate(r.shippedAt)}</span>,
  },
  {
    key: "deliveredAt",
    label: "Delivered",
    defaultVisible: false,
    sortable: true,
    render: (r) => <span className="text-zinc-500">{formatDate(r.deliveredAt)}</span>,
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

function downloadCsv(rows: OrderRow[], visibleColumns: string[]) {
  const cols = visibleColumns.map((k) => COLUMN_MAP.get(k)).filter(Boolean) as ColumnDef<OrderRow>[];
  const headers = cols.map((c) => csvEscape(c.label));

  const csvRows = rows.map((row) =>
    cols
      .map((c) => {
        const val = getValue(row, c.key);
        return csvEscape(val);
      })
      .join(","),
  );

  const csv = [headers.join(","), ...csvRows].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `orders-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ─── Component ───────────────────────────────────────────────

export function OrderList() {
  const navigate = useNavigate();
  const { data: orders = [], isLoading } = useOrders();
  const [cashSaleOpen, setCashSaleOpen] = useState(false);
  const { prefs, toggleSort, setFilter, toggleColumn, moveColumn } = useTablePreferences(
    "v2-orders",
    DEFAULT_VISIBLE,
    { key: "createdAt", dir: "desc" },
  );

  const actionNeeded = orders.filter(
    (o) => o.status === "needs_allocation" || o.status === "return_pending",
  ).length;

  // Global search
  const globalSearch = prefs.filters._global ?? "";
  const setGlobalSearch = useCallback(
    (v: string) => setFilter("_global", v),
    [setFilter],
  );

  // Apply filters then sort
  const processedRows = useMemo(() => {
    let result: OrderRow[] = orders;

    if (globalSearch) {
      const term = globalSearch.toLowerCase();
      result = result.filter(
        (r) =>
          r.orderNumber.toLowerCase().includes(term) ||
          (r.externalOrderId ?? "").toLowerCase().includes(term) ||
          (r.docNumber ?? "").toLowerCase().includes(term) ||
          (r.customer?.name ?? "Cash Sales").toLowerCase().includes(term),
      );
    }

    const columnFilters = Object.fromEntries(
      Object.entries(prefs.filters).filter(([k]) => k !== "_global"),
    );
    result = filterRows(result, columnFilters, getValue);
    result = sortRows(result, prefs.sort.key, prefs.sort.dir, getValue);

    return result;
  }, [orders, globalSearch, prefs.filters, prefs.sort]);

  const visibleCols = prefs.visibleColumns
    .map((k) => COLUMN_MAP.get(k))
    .filter(Boolean) as ColumnDef<OrderRow>[];

  if (isLoading) {
    return <p className="text-zinc-500 text-sm">Loading orders…</p>;
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <h1 className="text-[22px] font-bold text-zinc-900">Orders</h1>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-zinc-400" />
            <input
              value={globalSearch}
              onChange={(e) => setGlobalSearch(e.target.value)}
              placeholder="Search order or customer…"
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
          <button
            onClick={() => setCashSaleOpen(true)}
            className="px-4 py-2 bg-amber-500 text-zinc-900 rounded-md font-bold text-[13px] hover:bg-amber-400 transition-colors cursor-pointer"
          >
            New Cash Sale
          </button>
        </div>
      </div>
      <p className="text-zinc-500 text-[13px] mb-5">
        {processedRows.length} of {orders.length} orders
        {actionNeeded > 0 && (
          <span className="text-amber-500">
            {" "}· {actionNeeded} need attention
          </span>
        )}
      </p>

      <CashSaleForm open={cashSaleOpen} onClose={() => setCashSaleOpen(false)} />

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
            {processedRows.map((row) => {
              const alert =
                row.status === "needs_allocation" || row.status === "return_pending";
              return (
                <tr
                  key={row.id}
                  onClick={() => navigate(`/admin/orders/${row.id}`)}
                  className="border-b border-zinc-200 cursor-pointer hover:bg-zinc-50 transition-colors"
                  style={{
                    background: alert ? "rgba(245,158,11,0.025)" : "transparent",
                  }}
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
              );
            })}
            {processedRows.length === 0 && (
              <tr>
                <td
                  colSpan={visibleCols.length}
                  className="px-3 py-8 text-center text-zinc-500 text-sm"
                >
                  No orders match your filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </SurfaceCard>
    </div>
  );
}
