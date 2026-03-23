import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrder, orderKeys } from "@/hooks/admin/use-orders";
import { stockUnitKeys } from "@/hooks/admin/use-stock-units";
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
import { AllocateItemsDialog } from "./AllocateItemsDialog";
import { ShipOrderDialog } from "./ShipOrderDialog";
import { ReturnDialog } from "./ReturnDialog";
import { ProcessReturnDialog } from "./ProcessReturnDialog";
import { toast } from "sonner";

interface OrderDetailProps {
  orderId: string;
}

export function OrderDetail({ orderId }: OrderDetailProps) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: order, isLoading } = useOrder(orderId);
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
  }) | null>(null);

  const markComplete = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from("sales_order")
        .update({ status: "complete" } as never)
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

  return (
    <div>
      <BackButton onClick={() => navigate("/admin/v2/orders")} label="Back to orders" />

      {/* Header */}
      <div className="flex items-start justify-between mb-5">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <h1 className="text-[22px] font-bold text-zinc-50">{order.orderNumber}</h1>
            <OrderStatusBadge status={order.status} />
          </div>
          <div className="flex gap-4 text-zinc-500 text-[13px]">
            <span>{customerName}</span>
            <span>{order.channel}</span>
            <span>{formattedDate}</span>
          </div>
        </div>
        <div className="flex gap-2">
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
                className="bg-[#3F3F46] text-zinc-400 border border-zinc-700/80 rounded-md px-4 py-2 text-[13px] cursor-pointer hover:text-zinc-200 transition-colors disabled:opacity-50"
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
      <div className="grid grid-cols-4 gap-3 mb-5">
        <SummaryCard label="Total" value={`£${order.total.toFixed(2)}`} color="#14B8A6" />
        <SummaryCard label="VAT" value={`£${order.vatAmount.toFixed(2)}`} color="#A1A1AA" />
        <SummaryCard label="Net" value={`£${order.netAmount.toFixed(2)}`} />
        <SummaryCard label="QBO" value={qboLabel} color={qboColor} />
      </div>

      {/* Line items table */}
      <SurfaceCard noPadding className="overflow-hidden">
        <div className="px-4 py-3 border-b border-zinc-700/80">
          <SectionHead>Line Items → Stock Units</SectionHead>
        </div>
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr className="border-b border-zinc-700/80">
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
              const itemAny = item as Record<string, unknown>;
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
                  className="border-b border-zinc-700/80"
                  style={{
                    background: isUnallocated
                      ? "rgba(245,158,11,0.03)"
                      : "transparent",
                  }}
                >
                  <td className="px-3 py-2.5">
                    <Mono color={item.sku ? "amber" : "dim"}>
                      {item.sku ?? "—"}
                    </Mono>
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
                          })
                        }
                        className="bg-transparent text-zinc-500 border border-zinc-700/80 rounded px-2 py-0.5 text-[10px] cursor-pointer hover:text-zinc-300 transition-colors"
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
      </SurfaceCard>

      {/* Unit slide-out */}
      <OrderUnitSlideOut
        lineItem={slideItem}
        open={!!slideItem}
        onClose={() => setSlideItem(null)}
      />

      {order && (
        <AllocateItemsDialog
          open={showAllocate}
          onClose={() => setShowAllocate(false)}
          orderId={order.id}
          lineItems={order.lineItems}
        />

        <ShipOrderDialog
          open={showShip}
          onClose={() => setShowShip(false)}
          orderId={order.id}
        />

        <ReturnDialog
          open={showReturn}
          onClose={() => setShowReturn(false)}
          orderId={order.id}
          lineItems={order.lineItems}
        />

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
