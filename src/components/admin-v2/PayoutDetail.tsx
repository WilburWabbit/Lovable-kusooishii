import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { calculateVAT } from "@/lib/utils/vat";
import {
  usePayout,
  usePayoutFees,
  usePayoutOrders,
  usePayoutTransactions,
  useReconcilePayout,
  useTriggerPayoutQBOSync,
  usePayoutQBOReadiness,
  useResetPayoutSync,
  type PayoutFeeWithLines,
  type PayoutTransaction,
} from "@/hooks/admin/use-payouts";
import { SurfaceCard, Mono, Badge, SectionHead } from "./ui-primitives";
import { toast } from "sonner";
import { ArrowLeft, ExternalLink, ChevronRight, ChevronDown } from "lucide-react";

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

function formatFeeType(raw: string): string {
  return raw
    .replace(/_/g, " ")
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

const TX_TYPE_COLORS: Record<string, string> = {
  SALE: "#22C55E",
  SHIPPING_LABEL: "#3B82F6",
  NON_SALE_CHARGE: "#F59E0B",
  TRANSFER: "#71717A",
  REFUND: "#EF4444",
  DISPUTE: "#EF4444",
  CREDIT: "#8B5CF6",
};

function TransactionTypeBadge({ type }: { type: string }) {
  const label = type.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  const color = TX_TYPE_COLORS[type] ?? "#71717A";
  return <Badge label={label} color={color} small />;
}

export function PayoutDetail({ payoutId }: { payoutId: string }) {
  const navigate = useNavigate();
  const { data: payout, isLoading } = usePayout(payoutId);
  const { data: payoutFees = [], isLoading: feesLoading } = usePayoutFees(payoutId);
  const { data: payoutOrders = [], isLoading: ordersLoading } = usePayoutOrders(payoutId);
  const { data: transactions = [], isLoading: txLoading } = usePayoutTransactions(payout?.externalPayoutId);
  const { data: qboReadiness } = usePayoutQBOReadiness(payout?.externalPayoutId);
  const reconcilePayout = useReconcilePayout();
  const triggerQBOSync = useTriggerPayoutQBOSync();
  const resetSync = useResetPayoutSync();
  const [expandedTxIds, setExpandedTxIds] = useState<Set<string>>(new Set());

  const toggleTx = (id: string) => {
    setExpandedTxIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const saleCount = useMemo(
    () => transactions.filter((t) => t.transactionType === "SALE").length,
    [transactions]
  );

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

      {/* 1. Totals */}
      <div className="grid grid-cols-3 gap-3 mb-3">
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
      <div className="grid grid-cols-3 gap-3 mb-5">
        <SurfaceCard>
          <div className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1">Ex-VAT Revenue</div>
          <Mono className="text-lg font-bold">£{calculateVAT(payout.grossAmount).net.toFixed(2)}</Mono>
        </SurfaceCard>
        <SurfaceCard>
          <div className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1">VAT on Fees</div>
          <Mono color="red" className="text-lg font-bold">£{calculateVAT(payout.totalFees).vat.toFixed(2)}</Mono>
        </SurfaceCard>
        <SurfaceCard>
          <div className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1">Ex-VAT Net</div>
          <Mono color="teal" className="text-lg font-bold">£{calculateVAT(payout.netAmount).net.toFixed(2)}</Mono>
        </SurfaceCard>
      </div>

      {/* 2. Channel Detail */}
      <SurfaceCard className="mb-5">
        {(() => {
          // Compute eBay payout total from transactions
          const ebayTotal = transactions.reduce((sum, tx) => {
            const amt = tx.netAmount;
            switch (tx.transactionType) {
              case "SALE":
              case "TRANSFER":
                return sum + amt;
              case "SHIPPING_LABEL":
              case "NON_SALE_CHARGE":
                return sum - amt;
              default:
                return sum + amt;
            }
          }, 0);
          const hasTransactions = transactions.length > 0;
          const mismatch = hasTransactions && Math.abs(ebayTotal - payout.netAmount) > 0.01;

          return (
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
                <div className="text-zinc-900 text-sm">{txLoading ? "—" : saleCount}</div>
              </div>
              <div>
                <div className="text-[10px] text-zinc-500 uppercase tracking-wider">Units</div>
                <div className="text-zinc-900 text-sm">{txLoading ? "—" : saleCount}</div>
              </div>
              {payout.externalPayoutId && (
                <div className="col-span-2 sm:col-span-4">
                  <div className="text-[10px] text-zinc-500 uppercase tracking-wider">External ID</div>
                  <Mono color="dim" className="text-xs">{payout.externalPayoutId}</Mono>
                </div>
              )}

              {/* eBay computed total vs DB net amount */}
              {hasTransactions && (
                <>
                  <div>
                    <div className="text-[10px] text-zinc-500 uppercase tracking-wider">eBay Total</div>
                    <Mono className={`text-sm font-semibold ${mismatch ? "text-red-600" : ""}`}>
                      £{ebayTotal.toFixed(2)}
                    </Mono>
                  </div>
                  <div>
                    <div className="text-[10px] text-zinc-500 uppercase tracking-wider">DB Net Amount</div>
                    <Mono className={`text-sm font-semibold ${mismatch ? "text-red-600" : ""}`}>
                      £{payout.netAmount.toFixed(2)}
                    </Mono>
                  </div>
                  {mismatch && (
                    <div className="col-span-2">
                      <div className="text-[10px] text-red-500 uppercase tracking-wider font-bold">⚠ Mismatch</div>
                      <Mono className="text-sm text-red-600 font-bold">
                        £{Math.abs(ebayTotal - payout.netAmount).toFixed(2)} difference
                      </Mono>
                    </div>
                  )}
                </>
              )}

              {/* QBO Deposit ID */}
              {payout.qboDepositId && (
                <div className="col-span-2 sm:col-span-4">
                  <div className="text-[10px] text-zinc-500 uppercase tracking-wider">QBO Deposit</div>
                  <div className="flex items-center gap-2">
                    <Mono color="dim" className="text-xs">#{payout.qboDepositId}</Mono>
                    <Badge
                      label={payout.qboSyncStatus === "synced" ? "Synced" : payout.qboSyncStatus ?? "—"}
                      color={payout.qboSyncStatus === "synced" ? "#22C55E" : "#F59E0B"}
                      small
                    />
                  </div>
                </div>
              )}
            </div>
          );
        })()}
      </SurfaceCard>

      {/* 3. Transactions (expandable rows) */}
      <SurfaceCard className="mb-5">
        <SectionHead>Transactions ({transactions.length})</SectionHead>
        {txLoading ? (
          <p className="text-zinc-400 text-xs">Loading transactions…</p>
        ) : transactions.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="border-b border-zinc-200">
                  <th className="w-6 px-1 py-1.5" />
                  <th className="text-left text-[10px] text-zinc-500 uppercase tracking-wider px-2 py-1.5">Type</th>
                  <th className="text-left text-[10px] text-zinc-500 uppercase tracking-wider px-2 py-1.5">Order / Memo</th>
                  <th className="text-left text-[10px] text-zinc-500 uppercase tracking-wider px-2 py-1.5">Buyer</th>
                   <th className="text-right text-[10px] text-zinc-500 uppercase tracking-wider px-2 py-1.5">Gross</th>
                   <th className="text-right text-[10px] text-zinc-500 uppercase tracking-wider px-2 py-1.5">Fees</th>
                   <th className="text-right text-[10px] text-zinc-500 uppercase tracking-wider px-2 py-1.5">Net</th>
                   <th className="text-right text-[10px] text-zinc-500 uppercase tracking-wider px-2 py-1.5">Ex-VAT</th>
                   <th className="text-right text-[10px] text-zinc-500 uppercase tracking-wider px-2 py-1.5">VAT on Fees</th>
                   <th className="text-center text-[10px] text-zinc-500 uppercase tracking-wider px-2 py-1.5">Status</th>
                </tr>
              </thead>
              <tbody>
                {transactions.map((tx) => {
                  const isExpanded = expandedTxIds.has(tx.id);
                  const feeDetails = tx.feeDetails as Array<{ feeType?: string; amount?: number | { value?: string }; currency?: string }> | null;
                  const hasFees = feeDetails && feeDetails.length > 0;

                  // Derive status: synced > matched > unmatched
                  const txStatus = (() => {
                    if (tx.qboPurchaseId && tx.qboPurchaseId !== "N/A") {
                      return { label: "Synced", color: "#22C55E" };
                    }
                    if (tx.matched) {
                      return { label: "Matched", color: "#3B82F6" };
                    }
                    return { label: "Unmatched", color: "#F59E0B" };
                  })();

                  return (
                    <>
                      <tr
                        key={tx.id}
                        className={`border-b border-zinc-100 ${hasFees ? "cursor-pointer hover:bg-zinc-50" : ""}`}
                        onClick={() => hasFees && toggleTx(tx.id)}
                      >
                        <td className="px-1 py-1.5 text-zinc-400">
                          {hasFees ? (
                            isExpanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />
                          ) : null}
                        </td>
                        <td className="px-2 py-1.5">
                          <TransactionTypeBadge type={tx.transactionType} />
                        </td>
                        <td className="px-2 py-1.5">
                          {tx.matchedOrderId ? (
                            <button
                              onClick={(e) => { e.stopPropagation(); navigate(`/admin/orders/${tx.matchedOrderId}`); }}
                              className="text-amber-600 hover:underline inline-flex items-center gap-1 bg-transparent border-none cursor-pointer text-xs p-0"
                            >
                              {tx.orderId}
                              <ExternalLink className="h-2.5 w-2.5" />
                            </button>
                          ) : (
                            <Mono color="dim" className="text-xs">{tx.orderId ?? tx.memo ?? "—"}</Mono>
                          )}
                        </td>
                        <td className="px-2 py-1.5 text-zinc-600">{tx.buyerUsername ?? "—"}</td>
                        <td className="px-2 py-1.5 text-right"><Mono className="text-xs">£{tx.grossAmount.toFixed(2)}</Mono></td>
                        <td className="px-2 py-1.5 text-right"><Mono color="red" className="text-xs">£{tx.totalFees.toFixed(2)}</Mono></td>
                        <td className="px-2 py-1.5 text-right"><Mono color="teal" className="text-xs">£{tx.netAmount.toFixed(2)}</Mono></td>
                        <td className="px-2 py-1.5 text-right"><Mono className="text-xs">£{calculateVAT(tx.grossAmount).net.toFixed(2)}</Mono></td>
                        <td className="px-2 py-1.5 text-right"><Mono color="red" className="text-xs">£{calculateVAT(tx.totalFees).vat.toFixed(2)}</Mono></td>
                        <td className="px-2 py-1.5 text-center">
                          <Badge
                            label={txStatus.label}
                            color={txStatus.color}
                            small
                          />
                        </td>
                      </tr>
                      {isExpanded && hasFees && (
                        <tr key={`${tx.id}-fees`}>
                          <td colSpan={10} className="bg-zinc-50 px-4 py-2 border-b border-zinc-100">
                            <div className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1.5">Fee Breakdown</div>
                            <table className="w-full">
                              <thead>
                                <tr>
                                  <th className="text-left text-[10px] text-zinc-400 uppercase tracking-wider py-0.5">Fee Type</th>
                                  <th className="text-right text-[10px] text-zinc-400 uppercase tracking-wider py-0.5">Gross</th>
                                  <th className="text-right text-[10px] text-zinc-400 uppercase tracking-wider py-0.5">Ex-VAT</th>
                                  <th className="text-right text-[10px] text-zinc-400 uppercase tracking-wider py-0.5">VAT</th>
                                </tr>
                              </thead>
                              <tbody>
                                {feeDetails!.map((fee, idx) => {
                                  const amt = typeof fee.amount === "number" ? fee.amount : parseFloat(fee.amount?.value ?? "0");
                                  const { net, vat } = calculateVAT(amt);
                                  return (
                                    <tr key={idx}>
                                      <td className="text-zinc-600 text-xs py-0.5">{formatFeeType(fee.feeType ?? "Unknown")}</td>
                                      <td className="text-right py-0.5"><Mono color="red" className="text-xs">£{amt.toFixed(2)}</Mono></td>
                                      <td className="text-right py-0.5"><Mono color="dim" className="text-xs">£{net.toFixed(2)}</Mono></td>
                                      <td className="text-right py-0.5"><Mono color="dim" className="text-xs">£{vat.toFixed(2)}</Mono></td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </td>
                        </tr>
                      )}
                    </>
                  );
                })}
              </tbody>
              <tfoot>
                {(() => {
                  const totGross = transactions.reduce((s, t) => s + t.grossAmount, 0);
                  const totFees = transactions.reduce((s, t) => s + t.totalFees, 0);
                  const totNet = transactions.reduce((s, t) => s + t.netAmount, 0);
                  const matchedCount = transactions.filter((t) => t.matched).length;
                  const totExVat = calculateVAT(totGross).net;
                  const totVatOnFees = calculateVAT(totFees).vat;
                  return (
                    <tr className="border-t-2 border-zinc-200 font-semibold">
                      <td className="px-1 py-1.5" />
                      <td className="px-2 py-1.5 text-xs text-zinc-500">Total</td>
                      <td className="px-2 py-1.5 text-xs text-zinc-400" colSpan={2}>{matchedCount}/{transactions.length} matched</td>
                      <td className="px-2 py-1.5 text-right"><Mono className="text-xs">£{totGross.toFixed(2)}</Mono></td>
                      <td className="px-2 py-1.5 text-right"><Mono color="red" className="text-xs">£{totFees.toFixed(2)}</Mono></td>
                      <td className="px-2 py-1.5 text-right"><Mono color="teal" className="text-xs">£{totNet.toFixed(2)}</Mono></td>
                      <td className="px-2 py-1.5 text-right"><Mono className="text-xs">£{totExVat.toFixed(2)}</Mono></td>
                      <td className="px-2 py-1.5 text-right"><Mono color="red" className="text-xs">£{totVatOnFees.toFixed(2)}</Mono></td>
                      <td />
                    </tr>
                  );
                })()}
              </tfoot>
            </table>
          </div>
        ) : (
          <p className="text-zinc-400 text-xs">No transactions found for this payout.</p>
        )}
      </SurfaceCard>

      {/* 4. Linked Orders */}
      <SurfaceCard className="mb-5">
        <SectionHead>Linked Orders ({orderFeeGroups.length || payoutOrders.length})</SectionHead>
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
                   <th className="text-right text-[10px] text-zinc-500 uppercase tracking-wider px-2 py-1.5">Ex-VAT</th>
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
                      <td className="px-2 py-1.5 text-right"><Mono color="dim">£{calculateVAT(total).net.toFixed(2)}</Mono></td>
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
                      <td className="px-2 py-1.5 text-right"><Mono color="dim" className="text-xs">£{calculateVAT(totTotal).net.toFixed(2)}</Mono></td>
                    </tr>
                  );
                })()}
              </tfoot>
            </table>
          </div>
        ) : ordersLoading ? (
          <p className="text-zinc-400 text-xs">Loading linked orders…</p>
        ) : payoutOrders.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="border-b border-zinc-200">
                  <th className="text-left text-[10px] text-zinc-500 uppercase tracking-wider px-2 py-1.5">Order</th>
                  <th className="text-left text-[10px] text-zinc-500 uppercase tracking-wider px-2 py-1.5">Reference</th>
                  <th className="text-left text-[10px] text-zinc-500 uppercase tracking-wider px-2 py-1.5">Status</th>
                  <th className="text-right text-[10px] text-zinc-500 uppercase tracking-wider px-2 py-1.5">Gross</th>
                  <th className="text-right text-[10px] text-zinc-500 uppercase tracking-wider px-2 py-1.5">Fees</th>
                  <th className="text-right text-[10px] text-zinc-500 uppercase tracking-wider px-2 py-1.5">Net</th>
                </tr>
              </thead>
              <tbody>
                {payoutOrders.map((po) => (
                  <tr key={po.salesOrderId} className="border-b border-zinc-100">
                    <td className="px-2 py-1.5">
                      <button
                        onClick={() => navigate(`/admin/orders/${po.salesOrderId}`)}
                        className="text-amber-600 hover:underline inline-flex items-center gap-1 bg-transparent border-none cursor-pointer text-xs p-0"
                      >
                        {po.orderNumber ?? po.salesOrderId.slice(0, 8)}
                        <ExternalLink className="h-2.5 w-2.5" />
                      </button>
                    </td>
                    <td className="px-2 py-1.5"><Mono color="dim">{po.originReference ?? "—"}</Mono></td>
                    <td className="px-2 py-1.5">
                      <Badge label={po.v2Status ?? "—"} color="#71717A" small />
                    </td>
                    <td className="px-2 py-1.5 text-right"><Mono>£{(po.orderGross ?? 0).toFixed(2)}</Mono></td>
                    <td className="px-2 py-1.5 text-right"><Mono color="red">£{(po.orderFees ?? 0).toFixed(2)}</Mono></td>
                    <td className="px-2 py-1.5 text-right"><Mono color="teal">£{(po.orderNet ?? 0).toFixed(2)}</Mono></td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-zinc-200 font-semibold">
                  <td className="px-2 py-1.5 text-xs text-zinc-500" colSpan={3}>Total ({payoutOrders.length} orders)</td>
                  <td className="px-2 py-1.5 text-right"><Mono className="text-xs">£{payoutOrders.reduce((s, o) => s + (o.orderGross ?? 0), 0).toFixed(2)}</Mono></td>
                  <td className="px-2 py-1.5 text-right"><Mono color="red" className="text-xs">£{payoutOrders.reduce((s, o) => s + (o.orderFees ?? 0), 0).toFixed(2)}</Mono></td>
                  <td className="px-2 py-1.5 text-right"><Mono color="teal" className="text-xs">£{payoutOrders.reduce((s, o) => s + (o.orderNet ?? 0), 0).toFixed(2)}</Mono></td>
                </tr>
              </tfoot>
            </table>
          </div>
        ) : (
          <p className="text-zinc-400 text-xs">No linked orders yet. Reconcile to match orders.</p>
        )}
      </SurfaceCard>

      {/* 5. Fee Breakdown — from fee_breakdown JSONB */}
      <SurfaceCard className="mb-5">
        <SectionHead>Fee Breakdown</SectionHead>
        {Object.keys(payout.feeBreakdown).length > 0 ? (
          <div className="grid gap-1.5">
            {Object.entries(payout.feeBreakdown).map(([key, amount]) => {
              const gross = amount ?? 0;
              const { net, vat } = calculateVAT(gross);
              return (
                <div key={key} className="flex justify-between py-1 border-b border-zinc-100">
                  <span className="text-zinc-600 text-xs">{formatFeeLabel(key)}</span>
                  <div className="flex gap-3">
                    <Mono color="dim" className="text-xs">£{gross.toFixed(2)}</Mono>
                    <Mono color="red" className="text-xs">£{net.toFixed(2)}</Mono>
                    <Mono color="dim" className="text-xs">£{vat.toFixed(2)}</Mono>
                  </div>
                </div>
              );
            })}
            <div className="flex justify-between py-1 border-b border-zinc-100 text-[10px] text-zinc-400">
              <span />
              <div className="flex gap-3">
                <span>Gross</span>
                <span>Ex-VAT</span>
                <span>VAT</span>
              </div>
            </div>
            <div className="flex justify-between py-1 font-semibold">
              <span className="text-zinc-700 text-xs">Total Fees</span>
              <div className="flex gap-3">
                <Mono color="dim" className="text-xs">£{payout.totalFees.toFixed(2)}</Mono>
                <Mono color="red" className="text-xs">£{calculateVAT(payout.totalFees).net.toFixed(2)}</Mono>
                <Mono color="dim" className="text-xs">£{calculateVAT(payout.totalFees).vat.toFixed(2)}</Mono>
              </div>
            </div>
          </div>
        ) : (
          <p className="text-zinc-400 text-xs">No fee breakdown available.</p>
        )}
      </SurfaceCard>

      {/* 6. QBO Readiness + Action buttons */}
      {qboReadiness && (qboReadiness.totalOrders > 0 || qboReadiness.totalExpenses > 0) && (
        <SurfaceCard className="mb-3">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs text-zinc-600">QBO Readiness:</span>
            <Badge
              label={`${qboReadiness.syncedOrders}/${qboReadiness.totalOrders} orders synced`}
              color={qboReadiness.ready ? "#22C55E" : "#F59E0B"}
              small
            />
            <Badge
              label={`${qboReadiness.createdExpenses}/${qboReadiness.totalExpenses} expenses created`}
              color={qboReadiness.pendingExpenses.length === 0 ? "#22C55E" : "#3B82F6"}
              small
            />
          </div>
          {qboReadiness.unsyncedOrders.length > 0 && (
            <div className="mt-2 space-y-1">
              <p className="text-[10px] text-zinc-500">Orders not yet in QBO:</p>
              {qboReadiness.unsyncedOrders.map((o) => (
                <button
                  key={o.id}
                  onClick={() => navigate(`/admin/orders/${o.id}`)}
                  className="text-amber-600 hover:underline text-xs bg-transparent border-none cursor-pointer p-0 flex items-center gap-1"
                >
                  {o.reference ?? o.id}
                  <ExternalLink className="h-2.5 w-2.5" />
                  {o.qboStatus && <span className="text-zinc-400 ml-1">({o.qboStatus})</span>}
                </button>
              ))}
            </div>
          )}
          {qboReadiness.pendingExpenses.length > 0 && (
            <div className="mt-2">
              <p className="text-[10px] text-zinc-500">{qboReadiness.pendingExpenses.length} expense(s) will be created during sync:</p>
              {qboReadiness.pendingExpenses.map((e) => (
                <div key={e.transactionId} className="text-xs text-zinc-500 ml-2">
                  {e.type.replace(/_/g, " ")} — £{e.amount.toFixed(2)}
                </div>
              ))}
            </div>
          )}
        </SurfaceCard>
      )}

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
            disabled={triggerQBOSync.isPending || (qboReadiness != null && !qboReadiness.ready)}
            className="flex-1 bg-zinc-100 text-zinc-500 border border-zinc-200 rounded-md py-2 text-[12px] cursor-pointer disabled:opacity-50 hover:text-zinc-700 transition-colors"
            title={qboReadiness && !qboReadiness.ready ? `${qboReadiness.unsyncedOrders.length} order(s) must be synced to QBO first` : undefined}
          >
            {triggerQBOSync.isPending ? "Syncing…" : "Sync to QBO"}
          </button>
        )}
      </div>
      <p className="text-[10px] text-zinc-400 mt-2">
        Reconcile matches orders to this payout by date range and transitions stock units to "payout_received".
      </p>

      {/* Reset Sync Section */}
      {payout.externalPayoutId && (
        <SurfaceCard className="mt-5">
          <SectionHead>Reset Sync</SectionHead>
          <p className="text-[10px] text-zinc-400 mb-3">
            Clear QBO sync data so this payout can be re-synced. You must delete the corresponding QBO records manually first.
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => {
                resetSync.mutate({ payoutId: payout.externalPayoutId!, scope: "expenses" }, {
                  onSuccess: (d: any) => toast.success(`Reset ${d.expensesReset ?? 0} expense records`),
                  onError: (err) => toast.error(err instanceof Error ? err.message : "Reset failed"),
                });
              }}
              disabled={resetSync.isPending}
              className="flex-1 bg-transparent text-red-500 border border-red-300 rounded-md py-1.5 text-[11px] font-medium cursor-pointer disabled:opacity-50 hover:bg-red-50 transition-colors"
            >
              Reset Expenses
            </button>
            <button
              onClick={() => {
                resetSync.mutate({ payoutId: payout.externalPayoutId!, scope: "deposit" }, {
                  onSuccess: () => toast.success("Deposit reset — ready to re-sync"),
                  onError: (err) => toast.error(err instanceof Error ? err.message : "Reset failed"),
                });
              }}
              disabled={resetSync.isPending}
              className="flex-1 bg-transparent text-red-500 border border-red-300 rounded-md py-1.5 text-[11px] font-medium cursor-pointer disabled:opacity-50 hover:bg-red-50 transition-colors"
            >
              Reset Deposit
            </button>
            <button
              onClick={() => {
                resetSync.mutate({ payoutId: payout.externalPayoutId!, scope: "all" }, {
                  onSuccess: (d: any) => toast.success(`Full reset: ${d.expensesReset ?? 0} expenses, deposit cleared`),
                  onError: (err) => toast.error(err instanceof Error ? err.message : "Reset failed"),
                });
              }}
              disabled={resetSync.isPending}
              className="flex-1 bg-red-500 text-white border-none rounded-md py-1.5 text-[11px] font-bold cursor-pointer disabled:opacity-50 hover:bg-red-600 transition-colors"
            >
              Reset All
            </button>
          </div>
        </SurfaceCard>
      )}
    </div>
  );
}
