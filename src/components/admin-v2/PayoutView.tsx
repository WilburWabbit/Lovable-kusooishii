import { useState, useMemo, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import {
  usePayouts,
  usePayoutSummary,
  useCreatePayout,
  useImportEbayPayouts,
} from "@/hooks/admin/use-payouts";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useTablePreferences } from "@/hooks/useTablePreferences";
import { sortRows, filterRows } from "@/lib/table-utils";
import type { ColumnDef } from "@/lib/table-utils";
import { ColumnSelector } from "@/components/admin/ColumnSelector";
import { SortableTableHead } from "@/components/admin/SortableTableHead";
import type { Payout } from "@/lib/types/admin";
import { SurfaceCard, Mono, Badge, SectionHead } from "./ui-primitives";
import { toast } from "sonner";
import { Download, Search } from "lucide-react";

// ─── Helpers ─────────────────────────────────────────────────

type PayoutRow = Payout;

function getValue(row: PayoutRow, key: string): unknown {
  return (row as unknown as Record<string, unknown>)[key];
}

const formatDate = (iso: string | null) => {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
};

// ─── Column definitions ──────────────────────────────────────

const COLUMNS: ColumnDef<PayoutRow>[] = [
  {
    key: "payoutDate",
    label: "Date",
    defaultVisible: true,
    sortable: true,
    render: (r) => <span className="text-zinc-600">{formatDate(r.payoutDate)}</span>,
  },
  {
    key: "channel",
    label: "Channel",
    defaultVisible: true,
    sortable: true,
    render: (r) => <span className="text-zinc-900">{r.channel}</span>,
  },
  {
    key: "grossAmount",
    label: "Gross",
    defaultVisible: true,
    sortable: true,
    align: "right",
    render: (r) => <Mono>£{r.grossAmount.toFixed(2)}</Mono>,
  },
  {
    key: "totalFees",
    label: "Fees",
    defaultVisible: true,
    sortable: true,
    align: "right",
    render: (r) => <Mono color="red">£{r.totalFees.toFixed(2)}</Mono>,
  },
  {
    key: "netAmount",
    label: "Net",
    defaultVisible: true,
    sortable: true,
    align: "right",
    render: (r) => <Mono color="teal">£{r.netAmount.toFixed(2)}</Mono>,
  },
  {
    key: "orderCount",
    label: "Orders",
    defaultVisible: true,
    sortable: true,
    align: "right",
    render: (r) => <span className="text-zinc-600">{r.orderCount}</span>,
  },
  {
    key: "reconciliationStatus",
    label: "Status",
    defaultVisible: true,
    sortable: true,
    render: (r) => {
      const isReconciled = r.reconciliationStatus === "reconciled";
      return (
        <Badge
          label={isReconciled ? "Reconciled" : "Pending"}
          color={isReconciled ? "#22C55E" : "#F59E0B"}
          small
        />
      );
    },
  },
  {
    key: "qboSyncStatus",
    label: "QBO",
    defaultVisible: true,
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
    key: "unitCount",
    label: "Units",
    defaultVisible: false,
    sortable: true,
    align: "right",
    render: (r) => <span className="text-zinc-600">{r.unitCount}</span>,
  },
  {
    key: "externalPayoutId",
    label: "External ID",
    defaultVisible: false,
    sortable: false,
    render: (r) => <Mono color="dim">{r.externalPayoutId ?? "—"}</Mono>,
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

function downloadCsv(rows: PayoutRow[], visibleColumns: string[]) {
  const cols = visibleColumns.map((k) => COLUMN_MAP.get(k)).filter(Boolean) as ColumnDef<PayoutRow>[];
  const headers = cols.map((c) => csvEscape(c.label));

  const csvRows = rows.map((row) =>
    cols.map((c) => csvEscape(getValue(row, c.key))).join(","),
  );

  const csv = [headers.join(","), ...csvRows].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `payouts-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ─── Component ───────────────────────────────────────────────

export function PayoutView() {
  const navigate = useNavigate();
  const { data: summary, isLoading: summaryLoading } = usePayoutSummary();
  const [showCreatePayout, setShowCreatePayout] = useState(false);
  const importEbay = useImportEbayPayouts();
  const { data: payouts = [], isLoading: payoutsLoading } = usePayouts();

  const { prefs, toggleSort, setFilter, toggleColumn, moveColumn } = useTablePreferences(
    "v2-payouts",
    DEFAULT_VISIBLE,
    { key: "payoutDate", dir: "desc" },
  );

  const globalSearch = prefs.filters._global ?? "";
  const setGlobalSearch = useCallback(
    (v: string) => setFilter("_global", v),
    [setFilter],
  );

  const processedRows = useMemo(() => {
    let result: PayoutRow[] = payouts;

    if (globalSearch) {
      const term = globalSearch.toLowerCase();
      result = result.filter(
        (r) =>
          r.channel.toLowerCase().includes(term) ||
          (r.externalPayoutId ?? "").toLowerCase().includes(term),
      );
    }

    const columnFilters = Object.fromEntries(
      Object.entries(prefs.filters).filter(([k]) => k !== "_global"),
    );
    result = filterRows(result, columnFilters, getValue);
    result = sortRows(result, prefs.sort.key, prefs.sort.dir, getValue);

    return result;
  }, [payouts, globalSearch, prefs.filters, prefs.sort]);

  const visibleCols = prefs.visibleColumns
    .map((k) => COLUMN_MAP.get(k))
    .filter(Boolean) as ColumnDef<PayoutRow>[];

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <h1 className="text-[22px] font-bold text-zinc-900">Payouts</h1>
        <div className="flex gap-2">
          <button
            onClick={() => {
              importEbay.mutate(undefined, {
                onSuccess: (data) => {
                  const d = data as Record<string, unknown>;
                  toast.success(`Imported ${d.imported ?? 0} eBay payouts`);
                },
                onError: (err) => toast.error(err instanceof Error ? err.message : "Import failed"),
              });
            }}
            disabled={importEbay.isPending}
            className="bg-zinc-200 text-zinc-600 border border-zinc-200 rounded-md px-3 py-1.5 text-xs cursor-pointer hover:text-zinc-800 transition-colors disabled:opacity-50"
          >
            {importEbay.isPending ? "Importing…" : "Import eBay Payouts"}
          </button>
          <button
            onClick={() => setShowCreatePayout(true)}
            className="bg-amber-500 text-zinc-900 border-none rounded-md px-3 py-1.5 font-bold text-xs cursor-pointer hover:bg-amber-400 transition-colors"
          >
            + Record Payout
          </button>
        </div>
      </div>
      <p className="text-zinc-500 text-[13px] mb-5">
        Channel payouts, fee breakdowns, reconciliation &amp; QBO sync.
      </p>

      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-3 mb-5">
        {summaryLoading ? (
          <p className="text-zinc-500 text-sm col-span-3">Loading summary…</p>
        ) : summary ? (
          <>
            <SurfaceCard>
              <div className="text-xs text-zinc-500 mb-2">eBay</div>
              <div className="font-mono text-[22px] text-teal-500 font-bold">
                £{summary.pendingByChannel.ebay.estimatedGross.toFixed(2)}
              </div>
              <div className="text-[11px] text-zinc-500 mt-2">
                {summary.pendingByChannel.ebay.orderCount} orders ·{" "}
                {summary.pendingByChannel.ebay.unitCount} units
              </div>
            </SurfaceCard>
            <SurfaceCard>
              <div className="text-xs text-zinc-500 mb-2">Stripe</div>
              <div className="font-mono text-[22px] text-teal-500 font-bold">
                £{summary.pendingByChannel.stripe.estimatedGross.toFixed(2)}
              </div>
              <div className="text-[11px] text-zinc-500 mt-2">
                {summary.pendingByChannel.stripe.orderCount} orders ·{" "}
                {summary.pendingByChannel.stripe.unitCount} units
              </div>
            </SurfaceCard>
            <SurfaceCard>
              <div className="text-xs text-zinc-500 mb-2">Blue Bell Owed</div>
              <div className="font-mono text-[22px] text-teal-500 font-bold">
                £{summary.blueBellCommission.owedSinceLastPayment.toFixed(2)}
              </div>
              <div className="text-[11px] text-zinc-500 mt-2">
                {summary.blueBellCommission.qualifyingOrderCount} qualifying
                orders · Manual
              </div>
              {summary.blueBellCommission.owedSinceLastPayment > 0 && (
                <button
                  onClick={() => toast.info("Record Payment — QBO expense integration coming soon")}
                  className="mt-2.5 w-full py-1.5 bg-zinc-200 text-zinc-600 border border-zinc-200 rounded text-[11px] cursor-pointer hover:text-zinc-800 transition-colors"
                >
                  Record Payment
                </button>
              )}
            </SurfaceCard>
          </>
        ) : null}
      </div>

      {/* Payouts table toolbar */}
      <div className="flex items-center justify-between mb-3">
        <SectionHead>Recent Payouts</SectionHead>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-zinc-400" />
            <input
              value={globalSearch}
              onChange={(e) => setGlobalSearch(e.target.value)}
              placeholder="Search ref or channel…"
              className="pl-8 pr-3 py-1.5 text-[13px] border border-zinc-300 rounded-md bg-white text-zinc-900 w-48 focus:outline-none focus:ring-1 focus:ring-amber-500 focus:border-amber-500"
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

      <SurfaceCard noPadding className="overflow-x-auto">
        {payoutsLoading ? (
          <p className="text-zinc-500 text-sm p-4">Loading payouts…</p>
        ) : (
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
                      <TableFilterInput
                        value={prefs.filters[col.key] ?? ""}
                        onChange={(v) => setFilter(col.key, v)}
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
                  onClick={() => navigate(`/admin/payouts/${row.id}`)}
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
                    className="px-3 py-6 text-center text-zinc-500 text-sm"
                  >
                    No payouts match your filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </SurfaceCard>

      {/* Create Payout Dialog */}
      <CreatePayoutDialog
        open={showCreatePayout}
        onClose={() => setShowCreatePayout(false)}
      />
    </div>
  );
}

// ─── Create Payout Dialog ───────────────────────────────────

function CreatePayoutDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const createPayout = useCreatePayout();
  const [channel, setChannel] = useState<"ebay" | "stripe">("ebay");
  const [payoutDate, setPayoutDate] = useState(new Date().toISOString().slice(0, 10));
  const [grossAmount, setGrossAmount] = useState("");
  const [sellingFees, setSellingFees] = useState("");
  const [shippingFees, setShippingFees] = useState("");
  const [otherFees, setOtherFees] = useState("");
  const [externalId, setExternalId] = useState("");
  const [notes, setNotes] = useState("");

  const totalFees =
    (parseFloat(sellingFees) || 0) +
    (parseFloat(shippingFees) || 0) +
    (parseFloat(otherFees) || 0);
  const netAmount = (parseFloat(grossAmount) || 0) - totalFees;

  const handleCreate = async () => {
    if (!grossAmount || parseFloat(grossAmount) <= 0) {
      toast.error("Gross amount is required");
      return;
    }

    try {
      await createPayout.mutateAsync({
        channel,
        payoutDate,
        grossAmount: parseFloat(grossAmount),
        totalFees: Math.round(totalFees * 100) / 100,
        netAmount: Math.round(netAmount * 100) / 100,
        feeBreakdown: {
          ebay_selling_fees: parseFloat(sellingFees) || 0,
          ebay_shipping: parseFloat(shippingFees) || 0,
          ebay_other_fees: parseFloat(otherFees) || 0,
        },
        externalPayoutId: externalId.trim() || undefined,
        notes: notes.trim() || undefined,
      });
      toast.success("Payout recorded");
      onClose();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to create payout");
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="bg-white border-zinc-200 text-zinc-900 max-w-lg">
        <DialogHeader>
          <DialogTitle>Record Payout</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3 mt-2">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <SectionHead>Channel</SectionHead>
              <select
                value={channel}
                onChange={(e) => setChannel(e.target.value as "ebay" | "stripe")}
                className="w-full px-2.5 py-2 bg-zinc-50 border border-zinc-200 rounded text-zinc-900 text-[13px]"
              >
                <option value="ebay">eBay</option>
                <option value="stripe">Stripe</option>
              </select>
            </div>
            <div>
              <SectionHead>Payout Date</SectionHead>
              <input
                type="date"
                value={payoutDate}
                onChange={(e) => setPayoutDate(e.target.value)}
                className="w-full px-2.5 py-2 bg-zinc-50 border border-zinc-200 rounded text-zinc-900 text-[13px]"
              />
            </div>
          </div>

          <div>
            <SectionHead>Gross Amount (£)</SectionHead>
            <input
              type="number"
              step="0.01"
              value={grossAmount}
              onChange={(e) => setGrossAmount(e.target.value)}
              className="w-full px-2.5 py-2 bg-zinc-50 border border-zinc-200 rounded text-zinc-900 text-[13px] font-mono"
            />
          </div>

          <SectionHead>Fee Breakdown (£)</SectionHead>
          <div className="grid grid-cols-3 gap-2">
            {[
              { label: "Selling Fees", value: sellingFees, onChange: setSellingFees },
              { label: "Shipping", value: shippingFees, onChange: setShippingFees },
              { label: "Other Fees", value: otherFees, onChange: setOtherFees },
            ].map((f) => (
              <div key={f.label}>
                <label className="text-[10px] text-zinc-500 block mb-0.5">{f.label}</label>
                <input
                  type="number"
                  step="0.01"
                  value={f.value}
                  onChange={(e) => f.onChange(e.target.value)}
                  className="w-full px-2 py-1.5 bg-zinc-50 border border-zinc-200 rounded text-zinc-900 text-xs font-mono"
                />
              </div>
            ))}
          </div>

          <div className="flex justify-between text-xs border-t border-zinc-200 pt-2">
            <span className="text-zinc-500">Total Fees: <Mono color="red">£{totalFees.toFixed(2)}</Mono></span>
            <span className="text-zinc-500">Net: <Mono color="teal">£{netAmount.toFixed(2)}</Mono></span>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <SectionHead>External ID</SectionHead>
              <input
                value={externalId}
                onChange={(e) => setExternalId(e.target.value)}
                placeholder="Optional"
                className="w-full px-2.5 py-2 bg-zinc-50 border border-zinc-200 rounded text-zinc-900 text-[13px]"
              />
            </div>
            <div>
              <SectionHead>Notes</SectionHead>
              <input
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Optional"
                className="w-full px-2.5 py-2 bg-zinc-50 border border-zinc-200 rounded text-zinc-900 text-[13px]"
              />
            </div>
          </div>

          <div className="flex gap-2 pt-2 border-t border-zinc-200">
            <button
              onClick={handleCreate}
              disabled={createPayout.isPending}
              className="flex-1 bg-amber-500 text-zinc-900 border-none rounded-md py-2.5 font-bold text-[13px] cursor-pointer disabled:opacity-50 hover:bg-amber-400 transition-colors"
            >
              {createPayout.isPending ? "Recording…" : "Record Payout"}
            </button>
            <button
              onClick={onClose}
              className="px-4 py-2.5 bg-zinc-100 text-zinc-400 border border-zinc-200 rounded-md text-[13px] cursor-pointer hover:text-zinc-700 transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
