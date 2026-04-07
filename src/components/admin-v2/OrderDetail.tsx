import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrder, orderKeys } from "@/hooks/admin/use-orders";
import { stockUnitKeys } from "@/hooks/admin/use-stock-units";
import { useOrderFees } from "@/hooks/admin/use-payouts";
import type { OrderLineItem, StockUnitStatus } from "@/lib/types/admin";
import {
  SurfaceCard,
  SummaryCard,
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
  const [slideItem, setSlideItem] = useState<(OrderLineItem & {
    unitUid?: string;
    unitStatus?: StockUnitStatus;
    landedCost?: number | null;
    carrier?: string | null;
    trackingNumber?: string | null;
    payoutStatus?: string;
    stockUnitIdForProfit?: string;
  }) | null>(null);

  // Fetch welcome code for eBay orders (QR label printing)
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

      // Update associated stock units
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

  // Aggregate fees by category
  const feeTotals = orderFees.reduce<Record<string, number>>((acc, fee) => {
    acc[fee.feeCategory] = (acc[fee.feeCategory] ?? 0) + fee.amount;
    return acc;
  }, {});
  const totalOrderFees = orderFees.reduce((s, f) => s + f.amount, 0);

  // COGS total
  const totalCogs = order?.lineItems.reduce((s, li) => s + (li.cogs ?? 0), 0) ?? 0;

  if (isLoading) {
    return <p className="text-zinc-500 text-sm">Loading order…</p>;
  }

  if (!order) {
    return <p className="text-zinc-500 text-sm">Order not found.</p>;
  }

  const customerName = order.customer?.name ?? "Cash Sales";
  const formattedDate = new Date(order.createdAt).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });

  const qboLabel =
    order.qboSyncStatus === "synced"
      ? "Synced"
      : order.qboSyncStatus === "error"
      ? "Error"
      : "Pending";
  const qboColor =
    order.qboSyncStatus === "synced"
      ? "#22C55E"
      : order.qboSyncStatus === "error"
      ? "#EF4444"
      : "#F59E0B";

  const netProfit = order.netAmount - totalCogs - totalOrderFees;

  return (
    <div className="pb-20 lg:pb-0">
      <BackButton onClick={() => navigate("/admin/orders")} label="Back to orders" />

      {/* Header */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between mb-5">
        <div>
          <div className="flex items-center gap-3 mb-1 flex-wrap">
            <h1 className="text-[22px] font-bold text-zinc-900">
              {order.externalOrderId || order.docNumber || order.orderNumber}
            </h1>
            <OrderStatusBadge status={order.status} />
          </div>
          <div className="flex flex-wrap gap-2 lg:gap-4 text-zinc-500 text-[13px]">
            <span className="text-zinc-400 font-mono text-[11px]">{order.orderNumber}</span>
            <span>{customerName}</span>
            <span>{order.channel}</span>
            <span>{formattedDate}</span>
            {order.externalOrderId && order.docNumber && order.externalOrderId !== order.docNumber && (
              <span className="text-zinc-400 font-mono text-[11px]">QBO: {order.docNumber}</span>
            )}
          </div>
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
          {order.status === "needs_allocation" && (
            <button
              onClick={() => setShowAllocate(true)}
              className="bg-amber-500 text-zinc-900 border-none rounded-md px-4 py-2 font-bold text-[13px] cursor-pointer hover:bg-amber-400 transition-colors"
            >
              Allocate Items
            </button>
          )}
          {(order.status === "new" || order.status === "awaiting_shipment") && (
            <button
              onClick={() => setShowShip(true)}
              className="bg-teal-500 text-zinc-900 border-none rounded-md px-4 py-2 font-bold text-[13px] cursor-pointer hover:bg-teal-400 transition-colors"
            >
              Ship Order
            </button>
          )}
          {(order.status === "shipped" || order.status === "delivered") && (
            <>
              <button
                onClick={() => setShowReturn(true)}
                className="bg-red-500/20 text-red-400 border border-red-500/30 rounded-md px-4 py-2 text-[13px] cursor-pointer hover:bg-red-500/30 transition-colors"
              >
                Initiate Return
              </button>
              <button
                onClick={() => markComplete.mutate()}
                disabled={markComplete.isPending}
                className="bg-zinc-200 text-zinc-600 border border-zinc-200 rounded-md px-4 py-2 text-[13px] cursor-pointer hover:text-zinc-800 transition-colors disabled:opacity-50"
              >
                {markComplete.isPending ? "Completing…" : "Mark Complete"}
              </button>
            </>
          )}
          {order.status === "return_pending" && (
            <button
              onClick={() => setShowProcessReturn(true)}
              className="bg-amber-500 text-zinc-900 border-none rounded-md px-4 py-2 font-bold text-[13px] cursor-pointer hover:bg-amber-400 transition-colors"
            >
              Process Return
            </button>
          )}
        </div>
      </div>

      {/* Summary cards */}
      <div className={`grid gap-3 mb-5 ${welcomeCode ? "grid-cols-2 lg:grid-cols-5" : "grid-cols-2 lg:grid-cols-4"}`}>
        <SummaryCard label="Total" value={`£${order.total.toFixed(2)}`} color="#14B8A6" />
        <SummaryCard label="VAT" value={`£${order.vatAmount.toFixed(2)}`} color="#A1A1AA" />
        <SummaryCard label="Net" value={`£${order.netAmount.toFixed(2)}`} />
        <SummaryCard label="QBO" value={qboLabel} color={qboColor} />
        {welcomeCode && (
          <SummaryCard
            label="Welcome Promo"
            value={welcomeCode.redeemed_at ? "Redeemed" : welcomeCode.scanned_at ? `Scanned ${welcomeCode.scan_count}×` : "Active"}
            color={welcomeCode.redeemed_at ? "#22C55E" : welcomeCode.scanned_at ? "#3B82F6" : "#F59E0B"}
          />
        )}
      </div>

      {/* Fees & Profit cards */}
      {(totalOrderFees > 0 || totalCogs > 0) && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
          <SummaryCard label="COGS" value={`£${totalCogs.toFixed(2)}`} color="#A1A1AA" />
          <SummaryCard label="Fees" value={`£${totalOrderFees.toFixed(2)}`} color="#EF4444" />
          <SummaryCard
            label="Net Profit"
            value={`£${netProfit.toFixed(2)}`}
            color={netProfit >= 0 ? "#22C55E" : "#EF4444"}
          />
          <SummaryCard
            label="Margin"
            value={order.netAmount > 0 ? `${((netProfit / order.netAmount) * 100).toFixed(1)}%` : "—"}
            color={netProfit >= 0 ? "#22C55E" : "#EF4444"}
          />
        </div>
      )}

      {/* Fee breakdown detail */}
      {Object.keys(feeTotals).length > 0 && (
        <SurfaceCard className="mb-5">
          <SectionHead>Fee Breakdown</SectionHead>
          <div className="grid gap-1">
            {Object.entries(feeTotals).map(([cat, amount]) => (
              <div key={cat} className="flex justify-between py-1 border-b border-zinc-100">
                <span className="text-zinc-600 text-xs capitalize">{cat.replace(/_/g, " ")}</span>
                <Mono color="red" className="text-xs">£{amount.toFixed(2)}</Mono>
              </div>
            ))}
          </div>
        </SurfaceCard>
      )}

      {/* Line items table */}
      <SurfaceCard noPadding className="overflow-hidden">
        <div className="px-4 py-3 border-b border-zinc-200">
          <SectionHead>Line Items → Stock Units</SectionHead>
        </div>
        <div className="overflow-x-auto">
        <table className="w-full border-collapse text-xs min-w-[640px]">
          <thead>
            <tr className="border-b border-zinc-200">
              {["SKU", "Unit ID", "Unit Price", "COGS", "Status", "Tracking", "Payout", ""].map(
                (h) => (
                  <th
                    key={h}
                    className="px-3 py-2 text-left text-zinc-500 font-medium text-[10px] uppercase tracking-wider"
                  >
                    {h}
                  </th>
                )
              )}
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

              // Determine payout status from unit lifecycle
              const payoutStatus = isUnallocated
                ? undefined
                : unitStatus === "payout_received" || unitStatus === "complete"
                ? "Received"
                : unitStatus === "return_pending"
                ? "Held"
                : "Pending";

              return (
                <tr
                  key={item.id}
                  className="border-b border-zinc-200"
                  style={{
                    background: isUnallocated
                      ? "rgba(245,158,11,0.03)"
                      : "transparent",
                  }}
                >
                  <td className="px-3 py-2.5">
                    <div>
                      <Mono color={item.sku ? "amber" : "dim"}>
                        {item.sku ?? "—"}
                      </Mono>
                      {item.name && (
                        <p className="text-[10px] text-zinc-500 mt-0.5 truncate max-w-[200px]">{item.name}</p>
                      )}
                    </div>
                  </td>
                  <td className="px-3 py-2.5">
                    <Mono color={isUnallocated ? "amber" : "default"}>
                      {isUnallocated ? "Unallocated" : unitUid ?? "—"}
                    </Mono>
                  </td>
                  <td className="px-3 py-2.5">
                    <Mono color="teal">£{item.unitPrice.toFixed(2)}</Mono>
                  </td>
                  <td className="px-3 py-2.5">
                    <Mono color={item.cogs ? "teal" : "dim"}>
                      {item.cogs ? `£${item.cogs.toFixed(2)}` : "—"}
                    </Mono>
                  </td>
                  <td className="px-3 py-2.5">
                    <StatusBadge status={unitStatus} />
                  </td>
                  <td className="px-3 py-2.5">
                    <Mono color="dim" className="text-[11px]">
                      {order.trackingNumber ?? "—"}
                    </Mono>
                  </td>
                  <td className="px-3 py-2.5">
                    {payoutStatus === "Received" ? (
                      <Badge label="Received" color="#22C55E" small />
                    ) : payoutStatus === "Pending" ? (
                      <Badge label="Pending" color="#F59E0B" small />
                    ) : (
                      <span className="text-zinc-500">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2.5">
                    {item.stockUnitId && (
                      <button
                        onClick={() =>
                          setSlideItem({
                            ...item,
                            unitUid: item.stockUnitId?.slice(0, 10),
                            unitStatus,
                            landedCost: item.cogs,
                            carrier: order.carrier,
                            trackingNumber: order.trackingNumber,
                            payoutStatus,
                            stockUnitIdForProfit: item.stockUnitId ?? undefined,
                          })
                        }
                        className="bg-transparent text-zinc-500 border border-zinc-200 rounded px-2 py-0.5 text-[10px] cursor-pointer hover:text-zinc-700 transition-colors"
                      >
                        View Unit
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
            {order.lineItems.length === 0 && (
              <tr>
                <td colSpan={8} className="px-3 py-6 text-center text-zinc-500 text-sm">
                  No line items.
                </td>
              </tr>
            )}
          </tbody>
        </table>
        </div>
      </SurfaceCard>

      {/* Mobile sticky actions */}
      {order.status === "needs_allocation" && (
        <StickyActions>
          <button onClick={() => setShowAllocate(true)} className="flex-1 bg-amber-500 text-zinc-900 rounded-md py-2.5 font-bold text-[13px]">
            Allocate Items
          </button>
        </StickyActions>
      )}
      {(order.status === "new" || order.status === "awaiting_shipment") && (
        <StickyActions>
          <button onClick={() => setShowShip(true)} className="flex-1 bg-teal-500 text-zinc-900 rounded-md py-2.5 font-bold text-[13px]">
            Ship Order
          </button>
        </StickyActions>
      )}
      {(order.status === "shipped" || order.status === "delivered") && (
        <StickyActions>
          <button onClick={() => setShowReturn(true)} className="flex-1 bg-red-500/20 text-red-600 border border-red-500/30 rounded-md py-2.5 text-[13px]">
            Return
          </button>
          <button onClick={() => markComplete.mutate()} disabled={markComplete.isPending} className="flex-1 bg-zinc-200 text-zinc-600 rounded-md py-2.5 text-[13px]">
            {markComplete.isPending ? "Completing…" : "Complete"}
          </button>
        </StickyActions>
      )}
      {order.status === "return_pending" && (
        <StickyActions>
          <button onClick={() => setShowProcessReturn(true)} className="flex-1 bg-amber-500 text-zinc-900 rounded-md py-2.5 font-bold text-[13px]">
            Process Return
          </button>
        </StickyActions>
      )}

      {/* Unit slide-out */}
      <OrderUnitSlideOut
        lineItem={slideItem}
        open={!!slideItem}
        onClose={() => setSlideItem(null)}
      />

      {order && showAllocate && (
        <AllocateItemsDialog
          open={showAllocate}
          onClose={() => setShowAllocate(false)}
          orderId={order.id}
          lineItems={order.lineItems}
        />
      )}

      {order && showShip && (
        <ShipOrderDialog
          open={showShip}
          onClose={() => setShowShip(false)}
          orderId={order.id}
        />
      )}

      {order && showReturn && (
        <ReturnDialog
          open={showReturn}
          onClose={() => setShowReturn(false)}
          orderId={order.id}
          lineItems={order.lineItems}
        />
      )}

      {order && showProcessReturn && (
        <ProcessReturnDialog
          open={showProcessReturn}
          onClose={() => setShowProcessReturn(false)}
          orderId={order.id}
          lineItems={order.lineItems}
        />
      )}
    </div>
  );
}
