import { useState, useMemo, useCallback } from "react";
import {
  usePayouts,
  usePayoutSummary,
  useCreatePayout,
  useReconcilePayout,
  useTriggerPayoutQBOSync,
  useImportEbayPayouts,
} from "@/hooks/admin/use-payouts";
import {
  usePayoutTransactions,
  useUnmatchedTransactions,
  useSkipTransaction,
} from "@/hooks/admin/use-payout-transactions";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
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
import type { Payout, PayoutTransaction } from "@/lib/types/admin";
import { SurfaceCard, Mono, Badge, SectionHead } from "./ui-primitives";
import { toast } from "sonner";
import { Download, Search, ChevronDown, ChevronRight } from "lucide-react";

// ─── Row type & accessor ─────────────────────────────────────

type PayoutRow = Payout;

function getValue(row: PayoutRow, key: string): unknown {
  switch (key) {
    case "fvf":
      return row.feeBreakdown.fvf;
    case "promotedListings":
      return row.feeBreakdown.promoted_listings;
    case "internationalFee":
      return row.feeBreakdown.international;
    case "processingFee":
      return row.feeBreakdown.processing;
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
    key: "unitCount",
    label: "Units",
    defaultVisible: true,
    sortable: true,
    align: "right",
    render: (r) => <span className="text-zinc-600">{r.unitCount}</span>,
  },
  {
    key: "matchedOrderCount",
    label: "Matched",
    defaultVisible: true,
    sortable: true,
    align: "right",
    render: (r) => <span className="text-green-600">{r.matchedOrderCount}</span>,
  },
  {
    key: "unmatchedTransactionCount",
    label: "Unmatched",
    defaultVisible: true,
    sortable: true,
    align: "right",
    render: (r) =>
      r.unmatchedTransactionCount > 0 ? (
        <span className="text-red-500 font-medium">{r.unmatchedTransactionCount}</span>
      ) : (
        <span className="text-zinc-400">0</span>
      ),
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
    key: "fvf",
    label: "FVF",
    defaultVisible: false,
    sortable: true,
    align: "right",
    render: (r) => <Mono color="red">£{r.feeBreakdown.fvf.toFixed(2)}</Mono>,
  },
  {
    key: "promotedListings",
    label: "Promoted",
    defaultVisible: false,
    sortable: true,
    align: "right",
    render: (r) => <Mono color="red">£{r.feeBreakdown.promoted_listings.toFixed(2)}</Mono>,
  },
  {
    key: "internationalFee",
    label: "International",
    defaultVisible: false,
    sortable: true,
    align: "right",
    render: (r) => <Mono color="red">£{r.feeBreakdown.international.toFixed(2)}</Mono>,
  },
  {
    key: "processingFee",
    label: "Processing",
    defaultVisible: false,
    sortable: true,
    align: "right",
    render: (r) => <Mono color="red">£{r.feeBreakdown.processing.toFixed(2)}</Mono>,
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
  const { data: summary, isLoading: summaryLoading } = usePayoutSummary();
  const [selectedPayout, setSelectedPayout] = useState<Payout | null>(null);
  const [showCreatePayout, setShowCreatePayout] = useState(false);
  const importEbay = useImportEbayPayouts();
  const reconcilePayout = useReconcilePayout();
  const triggerQBOSync = useTriggerPayoutQBOSync();
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
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between mb-1">
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
            {importEbay.isPending ? "Importing…" : "Import eBay"}
          </button>
          <button
            onClick={() => setShowCreatePayout(true)}
            className="bg-amber-500 text-zinc-900 border-none rounded-md px-3 py-1.5 font-bold text-xs cursor-pointer hover:bg-amber-400 transition-colors whitespace-nowrap"
          >
            + Record Payout
          </button>
        </div>
      </div>
      <p className="text-zinc-500 text-[13px] mb-5">
        Channel payouts, fee breakdowns, QBO sync.
      </p>

      {/* Summary cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
        {summaryLoading ? (
          <p className="text-zinc-500 text-sm col-span-4">Loading summary…</p>
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
            <UnmatchedSummaryCard />
          </>
        ) : null}
      </div>

      {/* Payouts table toolbar */}
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between mb-3">
        <SectionHead>Recent Payouts</SectionHead>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-zinc-400" />
            <input
              value={globalSearch}
              onChange={(e) => setGlobalSearch(e.target.value)}
              placeholder="Search channel or ID…"
              className="pl-8 pr-3 py-1.5 text-[13px] border border-zinc-300 rounded-md bg-white text-zinc-900 w-full sm:w-48 focus:outline-none focus:ring-1 focus:ring-amber-500 focus:border-amber-500"
            />
          </div>
          <div className="flex items-center gap-2">
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
      </div>

      {/* Mobile card list */}
      <div className="md:hidden">
        <SurfaceCard noPadding>
          {payoutsLoading ? (
            <p className="text-zinc-500 text-sm p-4">Loading payouts…</p>
          ) : processedRows.length === 0 ? (
            <p className="p-4 text-center text-zinc-500 text-sm">No payouts match your filters.</p>
          ) : (
            <div className="divide-y divide-zinc-200">
              {processedRows.map((row) => (
                <button
                  key={row.id}
                  onClick={() => setSelectedPayout(row)}
                  className="block w-full text-left p-4 active:bg-zinc-100 transition-colors"
                >
                  <div className="flex items-center justify-between mb-1">
                    <Badge
                      label={row.qboSyncStatus === "synced" ? "Synced" : row.qboSyncStatus === "error" ? "Error" : "Pending"}
                      color={row.qboSyncStatus === "synced" ? "#22C55E" : row.qboSyncStatus === "error" ? "#EF4444" : "#F59E0B"}
                      small
                    />
                    <span className="text-sm font-mono font-semibold text-teal-600">£{row.netAmount.toFixed(2)}</span>
                  </div>
                  <div className="text-sm font-medium text-zinc-900">{row.channel}</div>
                  <div className="text-xs text-zinc-500 mt-0.5">
                    {formatDate(row.payoutDate)} · {row.orderCount} orders · Fees £{row.totalFees.toFixed(2)}
                  </div>
                </button>
              ))}
            </div>
          )}
        </SurfaceCard>
      </div>

      {/* Desktop table */}
      <div className="hidden md:block">
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
                    onClick={() => setSelectedPayout(row)}
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
      </div>

      {/* Payout detail slide-out */}
      <Sheet open={!!selectedPayout} onOpenChange={(o) => !o && setSelectedPayout(null)}>
        <SheetContent side="right" className="w-full sm:w-[480px] sm:max-w-[480px] bg-white border-zinc-200 p-0 flex flex-col">
          <SheetHeader className="px-5 py-4 border-b border-zinc-200">
            <SheetTitle className="text-zinc-900 text-base font-bold">
              Payout Detail
            </SheetTitle>
          </SheetHeader>
          {selectedPayout && (
            <PayoutSlideOutContent
              payout={selectedPayout}
              onReconcile={() => {
                reconcilePayout.mutate(selectedPayout.id, {
                  onSuccess: () => toast.success("Payout reconciled"),
                  onError: (err) => toast.error(err instanceof Error ? err.message : "Reconciliation failed"),
                });
              }}
              onSyncQBO={() => {
                triggerQBOSync.mutate(selectedPayout.id, {
                  onSuccess: () => toast.success("QBO sync triggered"),
                  onError: (err) => toast.error(err instanceof Error ? err.message : "QBO sync failed"),
                });
              }}
              isReconciling={reconcilePayout.isPending}
              isSyncing={triggerQBOSync.isPending}
            />
          )}
        </SheetContent>
      </Sheet>

      {/* Unmatched Transactions Section */}
      <UnmatchedTransactionsPanel />

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
  const [fvf, setFvf] = useState("");
  const [promotedListings, setPromotedListings] = useState("");
  const [international, setInternational] = useState("");
  const [processing, setProcessing] = useState("");
  const [externalId, setExternalId] = useState("");
  const [notes, setNotes] = useState("");

  const totalFees =
    (parseFloat(fvf) || 0) +
    (parseFloat(promotedListings) || 0) +
    (parseFloat(international) || 0) +
    (parseFloat(processing) || 0);
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
          fvf: parseFloat(fvf) || 0,
          promoted_listings: parseFloat(promotedListings) || 0,
          international: parseFloat(international) || 0,
          processing: parseFloat(processing) || 0,
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
          <div className="grid grid-cols-2 gap-2">
            {[
              { label: "FVF", value: fvf, onChange: setFvf },
              { label: "Promoted Listings", value: promotedListings, onChange: setPromotedListings },
              { label: "International", value: international, onChange: setInternational },
              { label: "Processing", value: processing, onChange: setProcessing },
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

// ─── Transaction Type Badge ─────────────────────────────────

const TXN_TYPE_COLORS: Record<string, string> = {
  SALE: "#22C55E",
  REFUND: "#EF4444",
  SHIPPING_LABEL: "#3B82F6",
  CREDIT: "#8B5CF6",
  TRANSFER: "#F59E0B",
  NON_SALE_CHARGE: "#6B7280",
};

function TxnTypeBadge({ type }: { type: string }) {
  return <Badge label={type.replace(/_/g, " ")} color={TXN_TYPE_COLORS[type] ?? "#6B7280"} small />;
}

// ─── Unmatched Summary Card ────────────────────────────────

function UnmatchedSummaryCard() {
  const { data: unmatched = [] } = useUnmatchedTransactions();
  const count = unmatched.length;

  return (
    <SurfaceCard>
      <div className="text-xs text-zinc-500 mb-2">Unmatched</div>
      <div className={`font-mono text-[22px] font-bold ${count > 0 ? "text-red-500" : "text-zinc-400"}`}>
        {count}
      </div>
      <div className="text-[11px] text-zinc-500 mt-2">
        {count === 0 ? "All transactions matched" : `${count} transactions need review`}
      </div>
    </SurfaceCard>
  );
}

// ─── Payout Slide-Out Content ──────────────────────────────

function PayoutSlideOutContent({
  payout,
  onReconcile,
  onSyncQBO,
  isReconciling,
  isSyncing,
}: {
  payout: Payout;
  onReconcile: () => void;
  onSyncQBO: () => void;
  isReconciling: boolean;
  isSyncing: boolean;
}) {
  const { data: transactions = [], isLoading: txnLoading } = usePayoutTransactions(
    payout.externalPayoutId,
  );

  const formatDate = (iso: string | null) => {
    if (!iso) return "—";
    return new Date(iso).toLocaleDateString("en-GB", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  };

  return (
    <div className="flex-1 overflow-auto p-5 grid gap-4">
      {/* Header info */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <div className="text-[10px] text-zinc-500 uppercase tracking-wider">Channel</div>
          <div className="text-zinc-900 text-sm font-medium">{payout.channel}</div>
        </div>
        <div>
          <div className="text-[10px] text-zinc-500 uppercase tracking-wider">Date</div>
          <div className="text-zinc-900 text-sm">{formatDate(payout.payoutDate)}</div>
        </div>
        <div>
          <div className="text-[10px] text-zinc-500 uppercase tracking-wider">Gross</div>
          <Mono className="text-sm">£{payout.grossAmount.toFixed(2)}</Mono>
        </div>
        <div>
          <div className="text-[10px] text-zinc-500 uppercase tracking-wider">Net</div>
          <Mono color="teal" className="text-sm">£{payout.netAmount.toFixed(2)}</Mono>
        </div>
        <div>
          <div className="text-[10px] text-zinc-500 uppercase tracking-wider">Orders</div>
          <div className="text-zinc-900 text-sm">{payout.orderCount}</div>
        </div>
        <div>
          <div className="text-[10px] text-zinc-500 uppercase tracking-wider">Transactions</div>
          <div className="text-zinc-900 text-sm">{payout.transactionCount}</div>
        </div>
      </div>

      {/* Bank reference & external ID */}
      {(payout.bankReference || payout.externalPayoutId) && (
        <div className="grid grid-cols-2 gap-3">
          {payout.externalPayoutId && (
            <div>
              <div className="text-[10px] text-zinc-500 uppercase tracking-wider">Payout ID</div>
              <Mono color="dim" className="text-xs">{payout.externalPayoutId}</Mono>
            </div>
          )}
          {payout.bankReference && (
            <div>
              <div className="text-[10px] text-zinc-500 uppercase tracking-wider">Bank Ref</div>
              <Mono color="dim" className="text-xs">{payout.bankReference}</Mono>
            </div>
          )}
        </div>
      )}

      {/* Fee Breakdown */}
      <div>
        <SectionHead>Fee Breakdown</SectionHead>
        <div className="grid gap-1.5">
          {[
            { label: "Final Value Fee", amount: payout.feeBreakdown.fvf },
            { label: "Promoted Listings", amount: payout.feeBreakdown.promoted_listings },
            { label: "International", amount: payout.feeBreakdown.international },
            { label: "Processing / Other", amount: payout.feeBreakdown.processing },
          ]
            .filter((fee) => fee.amount > 0)
            .map((fee) => (
              <div key={fee.label} className="flex justify-between py-1 border-b border-zinc-200">
                <span className="text-zinc-600 text-xs">{fee.label}</span>
                <Mono color="red" className="text-xs">£{fee.amount.toFixed(2)}</Mono>
              </div>
            ))}
          <div className="flex justify-between py-1 font-semibold">
            <span className="text-zinc-700 text-xs">Total Fees</span>
            <Mono color="red" className="text-xs">£{payout.totalFees.toFixed(2)}</Mono>
          </div>
        </div>
      </div>

      {/* QBO Sync Status */}
      <div>
        <SectionHead>QBO Sync</SectionHead>
        <div className="grid grid-cols-2 gap-2 text-xs">
          <div>
            <span className="text-zinc-500">Status: </span>
            <Badge
              label={payout.qboSyncStatus === "synced" ? "Synced" : payout.qboSyncStatus === "error" ? "Error" : "Pending"}
              color={payout.qboSyncStatus === "synced" ? "#22C55E" : payout.qboSyncStatus === "error" ? "#EF4444" : "#F59E0B"}
              small
            />
          </div>
          {payout.qboDepositId && (
            <div>
              <span className="text-zinc-500">Deposit: </span>
              <Mono color="dim">{payout.qboDepositId}</Mono>
            </div>
          )}
          {payout.qboExpenseId && (
            <div>
              <span className="text-zinc-500">Expense: </span>
              <Mono color="dim">{payout.qboExpenseId}</Mono>
            </div>
          )}
          {payout.syncAttemptedAt && (
            <div>
              <span className="text-zinc-500">Last attempt: </span>
              <span className="text-zinc-600">{formatDate(payout.syncAttemptedAt)}</span>
            </div>
          )}
        </div>
        {payout.qboSyncError && (
          <div className="mt-2 p-2 bg-red-50 border border-red-200 rounded text-red-700 text-xs">
            {payout.qboSyncError}
          </div>
        )}
      </div>

      {/* Matching summary */}
      <div className="flex gap-3 text-xs">
        <span className="text-green-600">
          {payout.matchedOrderCount} matched
        </span>
        {payout.unmatchedTransactionCount > 0 && (
          <span className="text-red-500 font-medium">
            {payout.unmatchedTransactionCount} unmatched
          </span>
        )}
      </div>

      {/* Transaction list */}
      <div>
        <SectionHead>Transactions</SectionHead>
        {txnLoading ? (
          <p className="text-zinc-500 text-xs">Loading transactions…</p>
        ) : transactions.length === 0 ? (
          <p className="text-zinc-400 text-xs">No transaction detail available.</p>
        ) : (
          <div className="grid gap-1">
            {transactions.map((txn) => (
              <div
                key={txn.id}
                className="flex items-center justify-between py-1.5 px-2 border border-zinc-200 rounded text-xs"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <TxnTypeBadge type={txn.transactionType} />
                  <span className="text-zinc-600 truncate">
                    {txn.orderId ?? txn.memo ?? txn.transactionId}
                  </span>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <Mono color="teal">£{txn.netAmount.toFixed(2)}</Mono>
                  {txn.matched ? (
                    <span className="w-2 h-2 rounded-full bg-green-500" title="Matched" />
                  ) : txn.transactionType === "SALE" ? (
                    <span className="w-2 h-2 rounded-full bg-red-500" title="Unmatched" />
                  ) : (
                    <span className="w-2 h-2 rounded-full bg-zinc-300" />
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Action buttons */}
      <div className="flex gap-2 pt-3 border-t border-zinc-200">
        <button
          onClick={onReconcile}
          disabled={isReconciling}
          className="flex-1 bg-amber-500 text-zinc-900 border-none rounded-md py-2 font-bold text-[12px] cursor-pointer disabled:opacity-50 hover:bg-amber-400 transition-colors"
        >
          {isReconciling ? "Reconciling…" : "Reconcile Orders"}
        </button>
        {payout.qboSyncStatus !== "synced" && (
          <button
            onClick={onSyncQBO}
            disabled={isSyncing}
            className="flex-1 bg-zinc-100 text-zinc-500 border border-zinc-200 rounded-md py-2 text-[12px] cursor-pointer disabled:opacity-50 hover:text-zinc-700 transition-colors"
          >
            {isSyncing ? "Syncing…" : "Sync to QBO"}
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Unmatched Transactions Panel ──────────────────────────

function UnmatchedTransactionsPanel() {
  const { data: unmatched = [], isLoading } = useUnmatchedTransactions();
  const skipTransaction = useSkipTransaction();
  const [expanded, setExpanded] = useState(false);

  if (isLoading || unmatched.length === 0) return null;

  return (
    <div className="mt-5">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1.5 mb-2 cursor-pointer bg-transparent border-none p-0"
      >
        {expanded ? (
          <ChevronDown className="h-4 w-4 text-zinc-500" />
        ) : (
          <ChevronRight className="h-4 w-4 text-zinc-500" />
        )}
        <SectionHead>
          Unmatched Transactions ({unmatched.length})
        </SectionHead>
      </button>
      {expanded && (
        <SurfaceCard noPadding className="overflow-x-auto">
          <table className="w-full border-collapse text-[13px]">
            <thead>
              <tr className="border-b border-zinc-200">
                <th className="px-3 py-2 text-left text-[10px] uppercase tracking-wider font-medium text-zinc-500">
                  eBay Order
                </th>
                <th className="px-3 py-2 text-left text-[10px] uppercase tracking-wider font-medium text-zinc-500">
                  Type
                </th>
                <th className="px-3 py-2 text-right text-[10px] uppercase tracking-wider font-medium text-zinc-500">
                  Amount
                </th>
                <th className="px-3 py-2 text-left text-[10px] uppercase tracking-wider font-medium text-zinc-500">
                  Date
                </th>
                <th className="px-3 py-2 text-left text-[10px] uppercase tracking-wider font-medium text-zinc-500">
                  Payout
                </th>
                <th className="px-3 py-2 text-right text-[10px] uppercase tracking-wider font-medium text-zinc-500">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {unmatched.map((txn) => (
                <tr key={txn.id} className="border-b border-zinc-200">
                  <td className="px-3 py-2">
                    <Mono color="dim">{txn.orderId ?? "—"}</Mono>
                  </td>
                  <td className="px-3 py-2">
                    <TxnTypeBadge type={txn.transactionType} />
                  </td>
                  <td className="px-3 py-2 text-right">
                    <Mono color="teal">£{txn.grossAmount.toFixed(2)}</Mono>
                  </td>
                  <td className="px-3 py-2 text-zinc-600">
                    {new Date(txn.transactionDate).toLocaleDateString("en-GB", {
                      day: "numeric",
                      month: "short",
                    })}
                  </td>
                  <td className="px-3 py-2">
                    <Mono color="dim" className="text-xs">{txn.payoutId}</Mono>
                  </td>
                  <td className="px-3 py-2 text-right">
                    <button
                      onClick={() => {
                        skipTransaction.mutate(txn.id, {
                          onSuccess: () => toast.success("Transaction skipped"),
                          onError: (err) =>
                            toast.error(err instanceof Error ? err.message : "Skip failed"),
                        });
                      }}
                      disabled={skipTransaction.isPending}
                      className="text-zinc-400 hover:text-zinc-700 text-[11px] cursor-pointer bg-transparent border-none transition-colors"
                    >
                      Skip
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </SurfaceCard>
      )}
    </div>
  );
}
