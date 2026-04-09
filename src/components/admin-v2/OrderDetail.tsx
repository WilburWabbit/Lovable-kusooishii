import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrder, orderKeys } from "@/hooks/admin/use-orders";
import { stockUnitKeys } from "@/hooks/admin/use-stock-units";
import { useOrderFees } from "@/hooks/admin/use-payouts";
import { exVAT } from "@/lib/utils/vat";
import type { OrderLineItem, StockUnitStatus } from "@/lib/types/admin";
import {
  SurfaceCard,
  Mono,
  Badge,
  StatusBadge,
  OrderStatusBadge,
  SectionHead,
  BackButton,
} from "./ui-primitives";
import { OrderUnitSlideOut } from "./OrderUnitSlideOut";
import { StickyActions } from "./StickyActions";
import { AllocateItemsDialog } from "./AllocateItemsDialog";
import { ShipOrderDialog } from "./ShipOrderDialog";
import { ReturnDialog } from "./ReturnDialog";
import { ProcessReturnDialog } from "./ProcessReturnDialog";
import { WelcomeQrLabel } from "./WelcomeQrLabel";
import { CompleteOrderModal } from "./CompleteOrderModal";
import { toast } from "sonner";

interface OrderDetailProps {
  orderId: string;
}

export function OrderDetail({ orderId }: OrderDetailProps) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: order, isLoading } = useOrder(orderId);
  const { data: orderFees = [] } = useOrderFees(orderId);
  const [showAllocate, setShowAllocate] = useState(false);
  const [showShip, setShowShip] = useState(false);
  const [showReturn, setShowReturn] = useState(false);
  const [showProcessReturn, setShowProcessReturn] = useState(false);
  const [showComplete, setShowComplete] = useState(false);
  const [slideItem, setSlideItem] = useState<(OrderLineItem & {
    unitUid?: string;
    unitStatus?: StockUnitStatus;
    landedCost?: number | null;
    carrier?: string | null;
    trackingNumber?: string | null;
    payoutStatus?: string;
    stockUnitIdForProfit?: string;
  }) | null>(null);

  const { data: welcomeCode } = useQuery({
    queryKey: ["welcome-code", "order", orderId],
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from("welcome_code")
        .select("code, promo_code, ebay_order_id, primary_sku, order_postcode, buyer_name, redeemed_at, scan_count, scanned_at")
        .eq("sales_order_id", orderId)
        .maybeSingle();
      return data as any;
    },
    enabled: !!order?.id && order?.channel === "ebay",
  });

  const markComplete = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from("sales_order")
        .update({ v2_status: "complete" } as never)
        .eq("id", orderId);
      if (error) throw error;
      await supabase
        .from("stock_unit")
        .update({ v2_status: "complete", completed_at: new Date().toISOString() } as never)
        .eq("order_id" as never, orderId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: orderKeys.all });
      queryClient.invalidateQueries({ queryKey: orderKeys.detail(orderId) });
      queryClient.invalidateQueries({ queryKey: stockUnitKeys.all });
      toast.success("Order marked as complete");
    },
  });

  // Aggregate fees
  const feeTotals = orderFees.reduce<Record<string, number>>((acc, fee) => {
    acc[fee.feeCategory] = (acc[fee.feeCategory] ?? 0) + fee.amount;
    return acc;
  }, {});
  const totalOrderFees = orderFees.reduce((s, f) => s + f.amount, 0);
  const totalCogs = order?.lineItems.reduce((s, li) => s + (li.cogs ?? 0), 0) ?? 0;

  if (isLoading) return <p className="text-muted-foreground text-sm">Loading order…</p>;
  if (!order) return <p className="text-muted-foreground text-sm">Order not found.</p>;

  const customerName = order.customer?.name ?? "Cash Sales";
  const formattedDate = new Date(order.createdAt).toLocaleDateString("en-GB", {
    day: "numeric", month: "short", year: "numeric",
  });

  const qboLabel = order.qboSyncStatus === "synced" ? "Synced" : order.qboSyncStatus === "error" ? "Error" : "Pending";
  const qboColor = order.qboSyncStatus === "synced" ? "#22C55E" : order.qboSyncStatus === "error" ? "#EF4444" : "#F59E0B";

  // Invoice totals
  const subtotalExVat = order.lineItems.reduce((s, li) => s + (li.unitPrice - li.lineVat), 0);
  const totalVat = order.lineItems.reduce((s, li) => s + li.lineVat, 0);
  const grossTotal = order.total;

  // P&L (ex-VAT)
  const netRevenue = subtotalExVat;
  // COGS is already stored ex-VAT — use as-is
  const netCogs = totalCogs;
  const netFees = exVAT(totalOrderFees);
  const netProfit = netRevenue - netCogs - netFees;
  const margin = netRevenue > 0 ? (netProfit / netRevenue) * 100 : 0;
  // Input VAT on stock = ex-VAT cost × 20%
  const vatReclaimCogs = totalCogs * 0.2;
  const vatReclaimFees = totalOrderFees - netFees;
  const totalVatReclaim = vatReclaimCogs + vatReclaimFees;

  const fmt = (n: number) => `£${n.toFixed(2)}`;

  return (
    <div className="pb-20 lg:pb-0">
      <BackButton onClick={() => navigate("/admin/orders")} label="Back to orders" />

      {/* ── Header ────────────────────────────────── */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between mb-5">
        <div>
          <div className="flex items-center gap-3 mb-1 flex-wrap">
            <h1 className="text-[22px] font-bold text-foreground">
              {order.externalOrderId || order.docNumber || order.orderNumber}
            </h1>
            <OrderStatusBadge status={order.status} />
            <Badge label={qboLabel} color={qboColor} small />
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-muted-foreground text-[13px]">
            <span>{customerName}</span>
            <span className="capitalize">{order.channel}</span>
            <span>{formattedDate}</span>
            {order.carrier && <span>{order.carrier} {order.trackingNumber ?? ""}</span>}
            <span className="text-muted-foreground/50 font-mono text-[11px]">{order.orderNumber}</span>
            {order.externalOrderId && order.docNumber && order.externalOrderId !== order.docNumber && (
              <span className="text-muted-foreground/50 font-mono text-[11px]">QBO: {order.docNumber}</span>
            )}
          </div>
          {welcomeCode && (
            <div className="mt-1">
              <Badge
                label={welcomeCode.redeemed_at ? "Promo Redeemed" : welcomeCode.scanned_at ? `Scanned ${welcomeCode.scan_count}×` : "Promo Active"}
                color={welcomeCode.redeemed_at ? "#22C55E" : welcomeCode.scanned_at ? "#3B82F6" : "#F59E0B"}
                small
              />
            </div>
          )}
        </div>
        <div className="hidden lg:flex gap-2">
          {welcomeCode && (
            <WelcomeQrLabel
              code={welcomeCode.code}
              promoCode={welcomeCode.promo_code}
              ebayOrderId={welcomeCode.ebay_order_id}
              primarySku={welcomeCode.primary_sku ?? undefined}
              postcode={welcomeCode.order_postcode ?? undefined}
              buyerName={welcomeCode.buyer_name ?? undefined}
            />
          )}
          {order.status === "needs_allocation" && order.lineItems.length === 0 && order.channel === "in_person" && (
            <button onClick={() => setShowComplete(true)} className="bg-teal-500 text-zinc-900 border-none rounded-md px-4 py-2 font-bold text-[13px] cursor-pointer hover:bg-teal-400 transition-colors">
              Add Items & Complete
            </button>
          )}
          {order.status === "needs_allocation" && !(order.lineItems.length === 0 && order.channel === "in_person") && (
            <button onClick={() => setShowAllocate(true)} className="bg-amber-500 text-zinc-900 border-none rounded-md px-4 py-2 font-bold text-[13px] cursor-pointer hover:bg-amber-400 transition-colors">
              Allocate Items
            </button>
          )}
          {(order.status === "new" || order.status === "awaiting_shipment") && (
            <button onClick={() => setShowShip(true)} className="bg-teal-500 text-zinc-900 border-none rounded-md px-4 py-2 font-bold text-[13px] cursor-pointer hover:bg-teal-400 transition-colors">
              Ship Order
            </button>
          )}
          {(order.status === "shipped" || order.status === "delivered") && (
            <>
              <button onClick={() => setShowReturn(true)} className="bg-red-500/20 text-red-400 border border-red-500/30 rounded-md px-4 py-2 text-[13px] cursor-pointer hover:bg-red-500/30 transition-colors">
                Initiate Return
              </button>
              <button onClick={() => markComplete.mutate()} disabled={markComplete.isPending} className="bg-zinc-200 text-zinc-600 border border-zinc-200 rounded-md px-4 py-2 text-[13px] cursor-pointer hover:text-zinc-800 transition-colors disabled:opacity-50">
                {markComplete.isPending ? "Completing…" : "Mark Complete"}
              </button>
            </>
          )}
          {order.status === "return_pending" && (
            <button onClick={() => setShowProcessReturn(true)} className="bg-amber-500 text-zinc-900 border-none rounded-md px-4 py-2 font-bold text-[13px] cursor-pointer hover:bg-amber-400 transition-colors">
              Process Return
            </button>
          )}
        </div>
      </div>

      {/* ── Invoice Line Items ────────────────────── */}
      <SurfaceCard noPadding className="overflow-hidden mb-5">
        <div className="px-4 py-3 border-b border-border">
          <SectionHead>Invoice</SectionHead>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-xs min-w-[700px]">
            <thead>
              <tr className="border-b border-border">
                {["Item", "SKU", "Qty", "Unit (ex-VAT)", "VAT", "Line Total", "COGS", ""].map((h) => (
                  <th key={h} className={`px-3 py-2 text-[10px] uppercase tracking-wider font-medium ${
                    ["Unit (ex-VAT)", "VAT", "Line Total", "COGS"].includes(h) ? "text-right" : "text-left"
                  } text-muted-foreground`}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {order.lineItems.map((item) => {
                const isUnallocated = !item.stockUnitId;
                const itemAny = item as unknown as Record<string, unknown>;
                const unitStatus: StockUnitStatus = isUnallocated
                  ? "needs_allocation"
                  : ((itemAny._unitStatus as StockUnitStatus) ?? "sold");
                const unitUid = (itemAny._unitUid as string) ?? item.stockUnitId?.slice(0, 10);
                const unitExVat = item.unitPrice - item.lineVat;

                const payoutStatus = isUnallocated
                  ? undefined
                  : unitStatus === "payout_received" || unitStatus === "complete"
                  ? "Received"
                  : unitStatus === "return_pending"
                  ? "Held"
                  : "Pending";

                return (
                  <tr key={item.id} className="border-b border-border" style={{ background: isUnallocated ? "rgba(245,158,11,0.03)" : "transparent" }}>
                    <td className="px-3 py-2.5">
                      <div>
                        <span className="text-foreground text-[12px]">{item.name ?? "—"}</span>
                        {isUnallocated && <StatusBadge status="needs_allocation" />}
                        {!isUnallocated && unitUid && (
                          <p className="text-muted-foreground/60 font-mono text-[10px] mt-0.5">{unitUid}</p>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-2.5">
                      <Mono color={item.sku ? "amber" : "dim"}>{item.sku ?? "—"}</Mono>
                    </td>
                    <td className="px-3 py-2.5 text-center">
                      <span className="text-foreground">1</span>
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      <Mono>{fmt(unitExVat)}</Mono>
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      <Mono color="dim">{fmt(item.lineVat)}</Mono>
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      <Mono color="teal">{fmt(item.unitPrice)}</Mono>
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      <Mono color={item.cogs ? "default" : "dim"}>
                        {item.cogs ? fmt(item.cogs) : "—"}
                      </Mono>
                    </td>
                    <td className="px-3 py-2.5">
                      {item.stockUnitId && (
                        <button
                          onClick={() => setSlideItem({
                            ...item,
                            unitUid: item.stockUnitId?.slice(0, 10),
                            unitStatus,
                            landedCost: item.cogs,
                            carrier: order.carrier,
                            trackingNumber: order.trackingNumber,
                            payoutStatus,
                            stockUnitIdForProfit: item.stockUnitId ?? undefined,
                          })}
                          className="bg-transparent text-muted-foreground border border-border rounded px-2 py-0.5 text-[10px] cursor-pointer hover:text-foreground transition-colors"
                        >
                          View
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
              {order.lineItems.length === 0 && (
                <tr><td colSpan={8} className="px-3 py-6 text-center text-muted-foreground text-sm">No line items.</td></tr>
              )}
            </tbody>
          </table>
        </div>

        {/* ── Invoice Totals ──────────────────────── */}
        <div className="border-t border-border px-4 py-3">
          <div className="flex flex-col items-end gap-1 text-xs">
            <div className="flex justify-between w-56">
              <span className="text-muted-foreground">Subtotal (ex-VAT)</span>
              <Mono>{fmt(subtotalExVat)}</Mono>
            </div>
            <div className="flex justify-between w-56">
              <span className="text-muted-foreground">VAT 20%</span>
              <Mono>{fmt(totalVat)}</Mono>
            </div>
            <div className="flex justify-between w-56 pt-1 border-t border-border font-semibold">
              <span className="text-foreground">Gross Total</span>
              <Mono color="teal">{fmt(grossTotal)}</Mono>
            </div>
          </div>
        </div>
      </SurfaceCard>

      {/* ── P&L Summary ───────────────────────────── */}
      {(totalOrderFees > 0 || totalCogs > 0) && (
        <SurfaceCard className="mb-5">
          <SectionHead>Profit & Loss (ex-VAT)</SectionHead>
          <div className="grid gap-1 text-xs max-w-sm">
            <div className="flex justify-between py-1">
              <span className="text-muted-foreground">Net Revenue</span>
              <Mono>{fmt(netRevenue)}</Mono>
            </div>
            <div className="flex justify-between py-1">
              <span className="text-muted-foreground">COGS</span>
              <Mono color="dim">{fmt(netCogs)}</Mono>
            </div>
            <div className="flex justify-between py-1">
              <span className="text-muted-foreground">Fees</span>
              <Mono color="dim">{fmt(netFees)}</Mono>
            </div>
            <div className="flex justify-between py-1.5 border-t border-border font-semibold">
              <span className="text-foreground">Net Profit</span>
              <span className="flex items-center gap-2">
                <Mono color={netProfit >= 0 ? "teal" : "red"}>{fmt(netProfit)}</Mono>
                <span className={`text-[11px] ${netProfit >= 0 ? "text-teal-600" : "text-red-500"}`}>
                  {margin.toFixed(1)}%
                </span>
              </span>
            </div>
            {totalVatReclaim > 0 && (
              <div className="flex justify-between py-1 text-blue-600">
                <span>VAT Reclaim</span>
                <Mono>{fmt(totalVatReclaim)}</Mono>
              </div>
            )}
          </div>
        </SurfaceCard>
      )}

      {/* ── Fee Breakdown ─────────────────────────── */}
      {Object.keys(feeTotals).length > 0 && (
        <SurfaceCard className="mb-5">
          <SectionHead>Fee Breakdown</SectionHead>
          <div className="grid gap-1">
            {Object.entries(feeTotals).map(([cat, amount]) => (
              <div key={cat} className="flex justify-between py-1 border-b border-border text-xs">
                <span className="text-muted-foreground capitalize">{cat.replace(/_/g, " ")}</span>
                <div className="flex gap-3">
                  <Mono color="dim">{fmt(exVAT(amount))} net</Mono>
                  <Mono color="red">{fmt(amount)} gross</Mono>
                </div>
              </div>
            ))}
          </div>
        </SurfaceCard>
      )}

      {/* ── Mobile Sticky Actions ─────────────────── */}
      {order.status === "needs_allocation" && (
        <StickyActions>
          <button onClick={() => setShowAllocate(true)} className="flex-1 bg-amber-500 text-zinc-900 rounded-md py-2.5 font-bold text-[13px]">Allocate Items</button>
        </StickyActions>
      )}
      {(order.status === "new" || order.status === "awaiting_shipment") && (
        <StickyActions>
          <button onClick={() => setShowShip(true)} className="flex-1 bg-teal-500 text-zinc-900 rounded-md py-2.5 font-bold text-[13px]">Ship Order</button>
        </StickyActions>
      )}
      {(order.status === "shipped" || order.status === "delivered") && (
        <StickyActions>
          <button onClick={() => setShowReturn(true)} className="flex-1 bg-red-500/20 text-red-600 border border-red-500/30 rounded-md py-2.5 text-[13px]">Return</button>
          <button onClick={() => markComplete.mutate()} disabled={markComplete.isPending} className="flex-1 bg-zinc-200 text-zinc-600 rounded-md py-2.5 text-[13px]">
            {markComplete.isPending ? "Completing…" : "Complete"}
          </button>
        </StickyActions>
      )}
      {order.status === "return_pending" && (
        <StickyActions>
          <button onClick={() => setShowProcessReturn(true)} className="flex-1 bg-amber-500 text-zinc-900 rounded-md py-2.5 font-bold text-[13px]">Process Return</button>
        </StickyActions>
      )}

      {/* ── Dialogs & Slide-out ───────────────────── */}
      <OrderUnitSlideOut lineItem={slideItem} open={!!slideItem} onClose={() => setSlideItem(null)} />
      {order && showAllocate && <AllocateItemsDialog open={showAllocate} onClose={() => setShowAllocate(false)} orderId={order.id} lineItems={order.lineItems} />}
      {order && showShip && <ShipOrderDialog open={showShip} onClose={() => setShowShip(false)} orderId={order.id} />}
      {order && showReturn && <ReturnDialog open={showReturn} onClose={() => setShowReturn(false)} orderId={order.id} lineItems={order.lineItems} />}
      {order && showProcessReturn && <ProcessReturnDialog open={showProcessReturn} onClose={() => setShowProcessReturn(false)} orderId={order.id} lineItems={order.lineItems} />}
    </div>
  );
}
