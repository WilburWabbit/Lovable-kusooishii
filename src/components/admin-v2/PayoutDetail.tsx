import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import {
  usePayout,
  usePayoutFees,
  usePayoutUnitCount,
  usePayoutTransactions,
  useReconcilePayout,
  useTriggerPayoutQBOSync,
  type PayoutFeeWithLines,
  type PayoutTransaction,
} from "@/hooks/admin/use-payouts";
import { SurfaceCard, Mono, Badge, SectionHead } from "./ui-primitives";
import { toast } from "sonner";
import { ArrowLeft, ExternalLink } from "lucide-react";

const formatDate = (iso: string | null) => {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
};

function formatFeeLabel(key: string): string {
  return key
    .replace(/^ebay_/, "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export function PayoutDetail({ payoutId }: { payoutId: string }) {
  const navigate = useNavigate();
  const { data: payout, isLoading } = usePayout(payoutId);
  const { data: payoutFees = [], isLoading: feesLoading } = usePayoutFees(payoutId);
  const { data: liveUnitCount, isLoading: unitCountLoading } = usePayoutUnitCount(payoutId);
  const { data: transactions = [], isLoading: txLoading } = usePayoutTransactions(payout?.externalPayoutId);
  const reconcilePayout = useReconcilePayout();
  const triggerQBOSync = useTriggerPayoutQBOSync();

  const orderFeeGroups = useMemo(() => {
    if (!payoutFees.length) return [];
    const groups = new Map<string, { salesOrderId: string | null; externalOrderId: string; fees: PayoutFeeWithLines[] }>();
    for (const fee of payoutFees) {
      const key = fee.externalOrderId ?? fee.salesOrderId ?? fee.id;
      const existing = groups.get(key);
      if (existing) {
        existing.fees.push(fee);
      } else {
        groups.set(key, {
          salesOrderId: fee.salesOrderId,
          externalOrderId: fee.externalOrderId ?? "—",
          fees: [fee],
        });
      }
    }
    return Array.from(groups.values());
  }, [payoutFees]);

  const feeTotalsByCategory = useMemo(() => {
    const totals: Record<string, number> = {};
    for (const fee of payoutFees) {
      totals[fee.feeCategory] = (totals[fee.feeCategory] ?? 0) + fee.amount;
    }
    return totals;
  }, [payoutFees]);

  if (isLoading) {
    return <p className="text-zinc-500 text-sm">Loading payout…</p>;
  }

  if (!payout) {
    return <p className="text-zinc-500 text-sm">Payout not found.</p>;
  }

  return (
    <div>
      {/* Back + Title */}
      <button
        onClick={() => navigate("/admin/payouts")}
        className="flex items-center gap-1.5 text-zinc-500 hover:text-zinc-700 text-xs mb-4 bg-transparent border-none cursor-pointer p-0 transition-colors"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Back to Payouts
      </button>

      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-3">
          <h1 className="text-[22px] font-bold text-zinc-900">Payout Detail</h1>
          <Badge
            label={payout.reconciliationStatus === "reconciled" ? "Reconciled" : "Pending"}
            color={payout.reconciliationStatus === "reconciled" ? "#22C55E" : "#F59E0B"}
            small
          />
          {payout.qboSyncStatus && (
            <Badge
              label={payout.qboSyncStatus === "synced" ? "QBO Synced" : payout.qboSyncStatus === "error" ? "QBO Error" : "QBO Pending"}
              color={payout.qboSyncStatus === "synced" ? "#22C55E" : payout.qboSyncStatus === "error" ? "#EF4444" : "#F59E0B"}
              small
            />
          )}
        </div>
      </div>

      {/* Totals */}
      <div className="grid grid-cols-3 gap-3 mb-5">
        <SurfaceCard>
          <div className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1">Gross</div>
          <Mono className="text-lg font-bold">£{payout.grossAmount.toFixed(2)}</Mono>
        </SurfaceCard>
        <SurfaceCard>
          <div className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1">Fees</div>
          <Mono color="red" className="text-lg font-bold">£{payout.totalFees.toFixed(2)}</Mono>
        </SurfaceCard>
        <SurfaceCard>
          <div className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1">Net</div>
          <Mono color="teal" className="text-lg font-bold">£{payout.netAmount.toFixed(2)}</Mono>
        </SurfaceCard>
      </div>

      {/* Meta */}
      <SurfaceCard className="mb-5">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <div>
            <div className="text-[10px] text-zinc-500 uppercase tracking-wider">Channel</div>
            <div className="text-zinc-900 text-sm font-medium">{payout.channel}</div>
          </div>
          <div>
            <div className="text-[10px] text-zinc-500 uppercase tracking-wider">Date</div>
            <div className="text-zinc-900 text-sm">{formatDate(payout.payoutDate)}</div>
          </div>
          <div>
            <div className="text-[10px] text-zinc-500 uppercase tracking-wider">Orders</div>
            <div className="text-zinc-900 text-sm">{feesLoading ? "—" : orderFeeGroups.length}</div>
          </div>
          <div>
            <div className="text-[10px] text-zinc-500 uppercase tracking-wider">Units</div>
            <div className="text-zinc-900 text-sm">{unitCountLoading ? "—" : (liveUnitCount ?? 0)}</div>
          </div>
          {payout.externalPayoutId && (
            <div className="col-span-2 sm:col-span-4">
              <div className="text-[10px] text-zinc-500 uppercase tracking-wider">External ID</div>
              <Mono color="dim" className="text-xs">{payout.externalPayoutId}</Mono>
            </div>
          )}
        </div>
      </SurfaceCard>

      {/* Fee Breakdown — from fee_breakdown JSONB */}
      <SurfaceCard className="mb-5">
        <SectionHead>Fee Breakdown</SectionHead>
        {Object.keys(payout.feeBreakdown).length > 0 ? (
          <div className="grid gap-1.5">
            {Object.entries(payout.feeBreakdown).map(([key, amount]) => {
              const gross = amount ?? 0;
              const net = Math.round((gross / 1.2) * 100) / 100;
              return (
                <div key={key} className="flex justify-between py-1 border-b border-zinc-100">
                  <span className="text-zinc-600 text-xs">{formatFeeLabel(key)}</span>
                  <div className="flex gap-3">
                    <Mono color="dim" className="text-xs">£{gross.toFixed(2)}</Mono>
                    <Mono color="red" className="text-xs">£{net.toFixed(2)}</Mono>
                  </div>
                </div>
              );
            })}
            <div className="flex justify-between py-1 border-b border-zinc-100 text-[10px] text-zinc-400">
              <span />
              <div className="flex gap-3">
                <span>Gross</span>
                <span>Ex-VAT</span>
              </div>
            </div>
            <div className="flex justify-between py-1 font-semibold">
              <span className="text-zinc-700 text-xs">Total Fees</span>
              <div className="flex gap-3">
                <Mono color="dim" className="text-xs">£{payout.totalFees.toFixed(2)}</Mono>
                <Mono color="red" className="text-xs">£{(Math.round((payout.totalFees / 1.2) * 100) / 100).toFixed(2)}</Mono>
              </div>
            </div>
          </div>
        ) : (
          <p className="text-zinc-400 text-xs">No fee breakdown available.</p>
        )}
      </SurfaceCard>

      {/* Per-order fee detail from payout_fee table */}
      {payoutFees.length > 0 && (
        <SurfaceCard className="mb-5">
          <SectionHead>Fee Detail by Category</SectionHead>
          <div className="grid gap-1.5">
            {Object.entries(feeTotalsByCategory).map(([cat, total]) => (
              <div key={cat} className="flex justify-between py-1 border-b border-zinc-100">
                <span className="text-zinc-600 text-xs">{formatFeeLabel(cat)}</span>
                <Mono color="red" className="text-xs">£{total.toFixed(2)}</Mono>
              </div>
            ))}
          </div>
        </SurfaceCard>
      )}

      {/* Linked Orders */}
      <SurfaceCard className="mb-5">
        <SectionHead>Linked Orders ({orderFeeGroups.length})</SectionHead>
        {feesLoading ? (
          <p className="text-zinc-400 text-xs">Loading order fees…</p>
        ) : orderFeeGroups.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="border-b border-zinc-200">
                  <th className="text-left text-[10px] text-zinc-500 uppercase tracking-wider px-2 py-1.5">Order</th>
                  <th className="text-right text-[10px] text-zinc-500 uppercase tracking-wider px-2 py-1.5">Selling</th>
                  <th className="text-right text-[10px] text-zinc-500 uppercase tracking-wider px-2 py-1.5">Shipping</th>
                  <th className="text-right text-[10px] text-zinc-500 uppercase tracking-wider px-2 py-1.5">Other</th>
                  <th className="text-right text-[10px] text-zinc-500 uppercase tracking-wider px-2 py-1.5">Total</th>
                </tr>
              </thead>
              <tbody>
                {orderFeeGroups.map((group, i) => {
                  const selling = group.fees.filter(f => f.feeCategory === "selling_fee").reduce((s, f) => s + f.amount, 0);
                  const shipping = group.fees.filter(f => f.feeCategory === "shipping_label").reduce((s, f) => s + f.amount, 0);
                  const other = group.fees.filter(f => !["selling_fee", "shipping_label"].includes(f.feeCategory)).reduce((s, f) => s + f.amount, 0);
                  const total = group.fees.reduce((s, f) => s + f.amount, 0);

                  return (
                    <tr key={i} className="border-b border-zinc-100">
                      <td className="px-2 py-1.5">
                        {group.salesOrderId ? (
                          <button
                            onClick={() => navigate(`/admin/orders/${group.salesOrderId}`)}
                            className="text-amber-600 hover:underline inline-flex items-center gap-1 bg-transparent border-none cursor-pointer text-xs p-0"
                          >
                            {group.externalOrderId}
                            <ExternalLink className="h-2.5 w-2.5" />
                          </button>
                        ) : (
                          <Mono color="dim">{group.externalOrderId}</Mono>
                        )}
                      </td>
                      <td className="px-2 py-1.5 text-right"><Mono color="red">£{selling.toFixed(2)}</Mono></td>
                      <td className="px-2 py-1.5 text-right"><Mono color="red">£{shipping.toFixed(2)}</Mono></td>
                      <td className="px-2 py-1.5 text-right"><Mono color="red">£{other.toFixed(2)}</Mono></td>
                      <td className="px-2 py-1.5 text-right"><Mono color="red">£{total.toFixed(2)}</Mono></td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                {(() => {
                  const totSelling  = orderFeeGroups.reduce((s, g) => s + g.fees.filter(f => f.feeCategory === "selling_fee").reduce((a, f) => a + f.amount, 0), 0);
                  const totShipping = orderFeeGroups.reduce((s, g) => s + g.fees.filter(f => f.feeCategory === "shipping_label").reduce((a, f) => a + f.amount, 0), 0);
                  const totOther    = orderFeeGroups.reduce((s, g) => s + g.fees.filter(f => !["selling_fee", "shipping_label"].includes(f.feeCategory)).reduce((a, f) => a + f.amount, 0), 0);
                  const totTotal    = orderFeeGroups.reduce((s, g) => s + g.fees.reduce((a, f) => a + f.amount, 0), 0);
                  return (
                    <tr className="border-t-2 border-zinc-200 font-semibold">
                      <td className="px-2 py-1.5 text-xs text-zinc-500">Total</td>
                      <td className="px-2 py-1.5 text-right"><Mono color="red" className="text-xs">£{totSelling.toFixed(2)}</Mono></td>
                      <td className="px-2 py-1.5 text-right"><Mono color="red" className="text-xs">£{totShipping.toFixed(2)}</Mono></td>
                      <td className="px-2 py-1.5 text-right"><Mono color="red" className="text-xs">£{totOther.toFixed(2)}</Mono></td>
                      <td className="px-2 py-1.5 text-right"><Mono color="red" className="text-xs">£{totTotal.toFixed(2)}</Mono></td>
                    </tr>
                  );
                })()}
              </tfoot>
            </table>
          </div>
        ) : (
          <p className="text-zinc-400 text-xs">No linked orders yet. Reconcile to match orders.</p>
        )}
      </SurfaceCard>

      {/* Action buttons */}
      <div className="flex gap-2 pt-3">
        <button
          onClick={() => {
            reconcilePayout.mutate(payoutId, {
              onSuccess: (data) => {
                const d = data as Record<string, unknown>;
                const orders = (d.ordersLinked as number) ?? 0;
                const units = (d.unitsLinked as number) ?? 0;
                const transitioned = (d.unitsTransitioned as number) ?? 0;
                toast.success(`Reconciled: ${orders} orders, ${units} units linked, ${transitioned} transitioned`);
              },
              onError: (err) => toast.error(err instanceof Error ? err.message : "Reconciliation failed"),
            });
          }}
          disabled={reconcilePayout.isPending}
          className="flex-1 bg-amber-500 text-zinc-900 border-none rounded-md py-2 font-bold text-[12px] cursor-pointer disabled:opacity-50 hover:bg-amber-400 transition-colors"
        >
          {reconcilePayout.isPending ? "Reconciling…" : "Reconcile Orders"}
        </button>
        {payout.qboSyncStatus !== "synced" && (
          <button
            onClick={() => {
              triggerQBOSync.mutate(payoutId, {
                onSuccess: (data) => {
                  const d = data as Record<string, unknown>;
                  if (d.success) {
                    toast.success(`QBO synced — Deposit #${d.qbo_deposit_id}${d.qbo_expense_id ? `, Expense #${d.qbo_expense_id}` : ""}`);
                  } else {
                    toast.error(`QBO sync failed: ${d.error ?? "Unknown error"}`);
                  }
                },
                onError: (err) => toast.error(err instanceof Error ? err.message : "QBO sync failed"),
              });
            }}
            disabled={triggerQBOSync.isPending}
            className="flex-1 bg-zinc-100 text-zinc-500 border border-zinc-200 rounded-md py-2 text-[12px] cursor-pointer disabled:opacity-50 hover:text-zinc-700 transition-colors"
          >
            {triggerQBOSync.isPending ? "Syncing…" : "Sync to QBO"}
          </button>
        )}
      </div>
      <p className="text-[10px] text-zinc-400 mt-2">
        Reconcile matches orders to this payout by date range and transitions stock units to "payout_received".
      </p>
    </div>
  );
}
