import { useState, useMemo, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { usePurchaseBatches, useBatchUnitSummaries } from "@/hooks/admin/use-purchase-batches";
import type { BatchUnitSummary } from "@/hooks/admin/use-purchase-batches";
import type { PurchaseBatch } from "@/lib/types/admin";
import { useTablePreferences } from "@/hooks/useTablePreferences";
import { sortRows, filterRows } from "@/lib/table-utils";
import type { ColumnDef } from "@/lib/table-utils";
import { ColumnSelector } from "@/components/admin/ColumnSelector";
import { SortableTableHead } from "@/components/admin/SortableTableHead";
import { SurfaceCard, Mono, Badge } from "./ui-primitives";
import { TableFilterInput } from "./TableFilterInput";
import { MultiSelectFilter } from "./MultiSelectFilter";
import { supabase } from "@/integrations/supabase/client";
import { Download, Search } from "lucide-react";
import { toast } from "sonner";

// ─── Row type ────────────────────────────────────────────────

type PurchaseRow = PurchaseBatch & {
  totalUnits: number;
  ungradedCount: number;
  mpnCount: number;
  totalPurchaseValue: number;
};

function getValue(row: PurchaseRow, key: string): unknown {
  switch (key) {
    case "sharedShipping":
      return row.sharedCosts.shipping;
    case "sharedBroker":
      return row.sharedCosts.broker_fee;
    case "sharedOther":
      return row.sharedCosts.other;
    default:
      return (row as unknown as Record<string, unknown>)[key];
  }
}

const formatDate = (iso: string | null) => {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
};

const COLUMNS: ColumnDef<PurchaseRow>[] = [
  {
    key: "reference",
    label: "Ref",
    defaultVisible: true,
    sortable: true,
    render: (r) => <Mono color="amber">{r.reference || r.id}</Mono>,
  },
  {
    key: "id",
    label: "Batch ID",
    defaultVisible: true,
    sortable: true,
    render: (r) => <Mono color="dim">{r.id}</Mono>,
  },
  {
    key: "supplierName",
    label: "Supplier",
    defaultVisible: true,
    sortable: true,
    render: (r) => <span className="text-zinc-900 font-medium">{r.supplierName}</span>,
  },
  {
    key: "purchaseDate",
    label: "Date",
    defaultVisible: true,
    sortable: true,
    render: (r) => <span className="text-zinc-500">{formatDate(r.purchaseDate)}</span>,
  },
  {
    key: "status",
    label: "Status",
    defaultVisible: true,
    sortable: true,
    render: (r) => (
      <Badge
        label={r.status === "draft" ? "Draft" : "Recorded"}
        color={r.status === "draft" ? "#A1A1AA" : "#22C55E"}
        small
      />
    ),
  },
  {
    key: "totalUnits",
    label: "Units",
    defaultVisible: true,
    sortable: true,
    align: "right",
    render: (r) => <span className="text-zinc-600">{r.totalUnits || "—"}</span>,
  },
  {
    key: "ungradedCount",
    label: "Ungraded",
    defaultVisible: true,
    sortable: true,
    align: "right",
    render: (r) =>
      r.ungradedCount > 0 ? (
        <Badge label={String(r.ungradedCount)} color="#F59E0B" small />
      ) : r.totalUnits > 0 ? (
        <Badge label="0" color="#22C55E" small />
      ) : (
        <span className="text-zinc-400">—</span>
      ),
  },
  {
    key: "mpnCount",
    label: "MPNs",
    defaultVisible: false,
    sortable: true,
    align: "right",
    render: (r) => <span className="text-zinc-600">{r.mpnCount || "—"}</span>,
  },
  {
    key: "totalUnitCosts",
    label: "Unit Costs",
    defaultVisible: false,
    sortable: true,
    align: "right",
    render: (r) => <Mono>£{r.totalUnitCosts.toFixed(2)}</Mono>,
  },
  {
    key: "totalSharedCosts",
    label: "Shared",
    defaultVisible: true,
    sortable: true,
    align: "right",
    render: (r) => <Mono color="dim">£{r.totalSharedCosts.toFixed(2)}</Mono>,
  },
  {
    key: "totalPurchaseValue",
    label: "Total",
    defaultVisible: true,
    sortable: true,
    align: "right",
    render: (r) => <Mono color="teal">£{r.totalPurchaseValue.toFixed(2)}</Mono>,
  },
  {
    key: "supplierVatRegistered",
    label: "VAT Reg",
    defaultVisible: false,
    sortable: true,
    render: (r) =>
      r.supplierVatRegistered ? (
        <Badge label="Yes" color="#14B8A6" small />
      ) : (
        <span className="text-zinc-400">—</span>
      ),
  },
  {
    key: "sharedShipping",
    label: "Shipping",
    defaultVisible: false,
    sortable: true,
    align: "right",
    render: (r) => <Mono color="dim">£{r.sharedCosts.shipping.toFixed(2)}</Mono>,
  },
  {
    key: "sharedBroker",
    label: "Broker",
    defaultVisible: false,
    sortable: true,
    align: "right",
    render: (r) => <Mono color="dim">£{r.sharedCosts.broker_fee.toFixed(2)}</Mono>,
  },
  {
    key: "sharedOther",
    label: "Other",
    defaultVisible: false,
    sortable: true,
    align: "right",
    render: (r) => <Mono color="dim">£{r.sharedCosts.other.toFixed(2)}</Mono>,
  },
  {
    key: "qboSyncStatus",
    label: "QBO",
    defaultVisible: false,
    sortable: true,
    render: (r) => {
      const color =
        r.qboSyncStatus === "synced"
          ? "#22C55E"
          : r.qboSyncStatus === "error"
          ? "#EF4444"
          : r.qboSyncStatus === "skipped"
          ? "#A1A1AA"
          : "#F59E0B";
      const label =
        r.qboSyncStatus === "synced"
          ? "Synced"
          : r.qboSyncStatus === "error"
          ? "Error"
          : r.qboSyncStatus === "skipped"
          ? "Skipped"
          : "Pending";
      return <Badge label={label} color={color} small />;
    },
  },
  {
    key: "qboPurchaseId",
    label: "QBO ID",
    defaultVisible: false,
    sortable: false,
    render: (r) => <Mono color="dim">{r.qboPurchaseId ?? "—"}</Mono>,
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

export function PurchaseList() {
  const navigate = useNavigate();
  const { data: batches = [], isLoading } = usePurchaseBatches();
  const { data: summaryMap } = useBatchUnitSummaries();
  const [exporting, setExporting] = useState(false);

  const { prefs, toggleSort, setFilter, toggleColumn, moveColumn } = useTablePreferences(
    "v2-purchases",
    DEFAULT_VISIBLE,
    { key: "purchaseDate", dir: "desc" },
  );

  const globalSearch = prefs.filters._global ?? "";
  const setGlobalSearch = useCallback((v: string) => setFilter("_global", v), [setFilter]);

  const rows: PurchaseRow[] = useMemo(() => {
    return batches.map((b) => {
      const s: BatchUnitSummary | undefined = summaryMap?.get(b.id);
      return {
        ...b,
        totalUnits: s?.totalUnits ?? 0,
        ungradedCount: s?.ungradedCount ?? 0,
        mpnCount: s?.mpnCount ?? 0,
        totalPurchaseValue: b.totalUnitCosts + b.totalSharedCosts,
      };
    });
  }, [batches, summaryMap]);

  const totalUngraded = rows.reduce((s, r) => s + r.ungradedCount, 0);

  const processedRows = useMemo(() => {
    let result: PurchaseRow[] = rows;
    if (globalSearch) {
      const term = globalSearch.toLowerCase();
      result = result.filter(
        (r) =>
          r.id.toLowerCase().includes(term) ||
          (r.reference ?? "").toLowerCase().includes(term) ||
          (r.qboPurchaseId ?? "").toLowerCase().includes(term) ||
          r.supplierName.toLowerCase().includes(term),
      );
    }
    const columnFilters = Object.fromEntries(
      Object.entries(prefs.filters).filter(([k]) => k !== "_global"),
    );
    result = filterRows(result, columnFilters, getValue);
    result = sortRows(result, prefs.sort.key, prefs.sort.dir, getValue);
    return result;
  }, [rows, globalSearch, prefs.filters, prefs.sort]);

  const visibleCols = prefs.visibleColumns
    .map((k) => COLUMN_MAP.get(k))
    .filter(Boolean) as ColumnDef<PurchaseRow>[];

  if (isLoading) {
    return <p className="text-zinc-500 text-sm">Loading batches…</p>;
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <h1 className="text-[22px] font-bold text-zinc-900">Purchases</h1>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-zinc-400" />
            <input
              value={globalSearch}
              onChange={(e) => setGlobalSearch(e.target.value)}
              placeholder="Search ref or supplier…"
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
            onClick={() => handleExportCsv(batches, setExporting)}
            disabled={exporting || batches.length === 0}
            className="h-9 px-3 gap-1.5 inline-flex items-center text-[13px] border border-zinc-300 rounded-md bg-white text-zinc-700 hover:bg-zinc-50 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Download className="h-3.5 w-3.5" />
            {exporting ? "Exporting…" : "CSV"}
          </button>
          <button
            onClick={() => navigate("/admin/purchases/new")}
            className="bg-amber-500 text-zinc-900 border-none rounded-md px-4 py-2 font-bold text-[13px] cursor-pointer hover:bg-amber-400 transition-colors"
          >
            + New Purchase
          </button>
        </div>
      </div>
      <p className="text-zinc-500 text-[13px] mb-5">
        {processedRows.length} of {rows.length} batches
        {totalUngraded > 0 && (
          <span className="text-amber-500"> · {totalUngraded} units awaiting grading</span>
        )}
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
                    col.key === "status" ? (
                      <MultiSelectFilter
                        value={prefs.filters[col.key] ?? ""}
                        onChange={(value) => setFilter(col.key, value)}
                        placeholder="All statuses"
                        options={[
                          { value: "draft", label: "Draft" },
                          { value: "recorded", label: "Recorded" },
                        ]}
                      />
                    ) : col.key === "qboSyncStatus" ? (
                      <MultiSelectFilter
                        value={prefs.filters[col.key] ?? ""}
                        onChange={(value) => setFilter(col.key, value)}
                        placeholder="All QBO"
                        options={[
                          { value: "pending", label: "Pending" },
                          { value: "synced", label: "Synced" },
                          { value: "error", label: "Error" },
                          { value: "skipped", label: "Skipped" },
                        ]}
                      />
                    ) : (
                      <TableFilterInput
                        value={prefs.filters[col.key] ?? ""}
                        onChange={(v) => setFilter(col.key, v)}
                      />
                    )
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
                onClick={() => navigate(`/admin/purchases/${row.id}`)}
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
                  No purchase batches match your filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </SurfaceCard>
    </div>
  );
}

// ─── CSV Export (unit-level, unchanged) ─────────────────────

function csvEscape(value: unknown): string {
  const s = value == null ? "" : String(value);
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

const CSV_COLUMNS = [
  "Batch ID", "Supplier Ref", "QBO Purchase ID", "QBO Sync Status",
  "Supplier", "Purchase Date", "Supplier VAT Reg",
  "Shared Shipping", "Shared Broker Fee", "Shared Other",
  "MPN", "Product Name", "Line Qty", "Unit Cost", "Apportioned Cost", "Landed Cost/Unit",
  "Unit ID", "Unit UID", "Grade", "SKU", "Status", "Condition Flags", "Landed Cost",
  "Graded At", "Listed At", "Sold At", "Order ID",
];

async function handleExportCsv(
  batches: PurchaseBatch[],
  setExporting: (v: boolean) => void,
) {
  setExporting(true);
  try {
    const batchIds = batches.map((b) => b.id);

    const { data: lineRows, error: lineErr } = await supabase
      .from("purchase_line_items" as never)
      .select("*")
      .in("batch_id", batchIds)
      .order("created_at", { ascending: true });
    if (lineErr) throw lineErr;

    const { data: unitRows, error: unitErr } = await supabase
      .from("stock_unit")
      .select("*")
      .in("batch_id" as never, batchIds);
    if (unitErr) throw unitErr;

    const mpns = [...new Set((lineRows as Record<string, unknown>[]).map((r) => r.mpn as string))];
    const nameMap = new Map<string, string>();
    if (mpns.length > 0) {
      const { data: products } = await supabase
        .from("product")
        .select("mpn, name")
        .in("mpn", mpns);
      for (const p of (products ?? []) as Record<string, unknown>[]) {
        nameMap.set(p.mpn as string, (p.name as string) ?? "");
      }
    }

    const batchMap = new Map(batches.map((b) => [b.id, b]));
    const unitsByLine = new Map<string, Record<string, unknown>[]>();
    for (const u of (unitRows ?? []) as Record<string, unknown>[]) {
      const lineId = u.line_item_id as string;
      if (!lineId) continue;
      const list = unitsByLine.get(lineId) ?? [];
      list.push(u);
      unitsByLine.set(lineId, list);
    }

    const rows: string[] = [];
    for (const lineRow of (lineRows ?? []) as Record<string, unknown>[]) {
      const batch = batchMap.get(lineRow.batch_id as string);
      if (!batch) continue;
      const mpn = lineRow.mpn as string;
      const units = unitsByLine.get(lineRow.id as string) ?? [];
      if (units.length === 0) {
        rows.push(buildCsvRow(batch, lineRow, mpn, nameMap.get(mpn) ?? "", null));
      } else {
        for (const unit of units) {
          rows.push(buildCsvRow(batch, lineRow, mpn, nameMap.get(mpn) ?? "", unit));
        }
      }
    }

    const csv = [CSV_COLUMNS.map(csvEscape).join(","), ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `purchases-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);

    toast.success(`Exported ${rows.length} records`);
  } catch (err: unknown) {
    toast.error(err instanceof Error ? err.message : "Export failed");
  } finally {
    setExporting(false);
  }
}

function buildCsvRow(
  batch: PurchaseBatch,
  line: Record<string, unknown>,
  mpn: string,
  productName: string,
  unit: Record<string, unknown> | null,
): string {
  const vals = [
    batch.id, batch.reference ?? "", batch.qboPurchaseId ?? "", batch.qboSyncStatus ?? "",
    batch.supplierName, batch.purchaseDate,
    batch.supplierVatRegistered ? "Yes" : "No",
    batch.sharedCosts.shipping, batch.sharedCosts.broker_fee, batch.sharedCosts.other,
    mpn, productName,
    line.quantity, line.unit_cost, line.apportioned_cost, line.landed_cost_per_unit,
    unit?.id ?? "", unit?.uid ?? "",
    unit?.condition_grade ?? "",
    unit?.condition_grade ? `${mpn}.${unit.condition_grade}` : "",
    unit?.v2_status ?? "",
    unit?.condition_flags ? (unit.condition_flags as string[]).join("; ") : "",
    unit?.landed_cost ?? "",
    unit?.graded_at ?? "", unit?.listed_at ?? "", unit?.sold_at ?? "", unit?.order_id ?? "",
  ];
  return vals.map(csvEscape).join(",");
}
