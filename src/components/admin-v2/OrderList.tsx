import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useOrders } from "@/hooks/admin/use-orders";
import type { OrderDetail } from "@/lib/types/admin";
import { SurfaceCard, Mono, OrderStatusBadge } from "./ui-primitives";
import { CashSaleForm } from "./CashSaleForm";

export function OrderList() {
  const navigate = useNavigate();
  const { data: orders = [], isLoading } = useOrders();
  const [cashSaleOpen, setCashSaleOpen] = useState(false);

  const actionNeeded = orders.filter(
    (o) => o.status === "needs_allocation" || o.status === "return_pending"
  ).length;

  if (isLoading) {
    return <p className="text-zinc-500 text-sm">Loading orders…</p>;
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <h1 className="text-[22px] font-bold text-zinc-900">Orders</h1>
        <button
          onClick={() => setCashSaleOpen(true)}
          className="px-4 py-2 bg-amber-500 text-zinc-900 rounded-md font-bold text-[13px] hover:bg-amber-400 transition-colors"
        >
          New Cash Sale
        </button>
      </div>
      <p className="text-zinc-500 text-[13px] mb-5">
        {orders.length} orders
        {actionNeeded > 0 && (
          <span className="text-amber-500">
            {" "}· {actionNeeded} need attention
          </span>
        )}
      </p>

      <CashSaleForm open={cashSaleOpen} onClose={() => setCashSaleOpen(false)} />

      <SurfaceCard noPadding className="overflow-hidden">
        <table className="w-full border-collapse text-[13px]">
          <thead>
            <tr className="border-b border-zinc-200">
              {["Order", "Customer", "Channel", "Items", "Total", "VAT", "Status", "Date"].map(
                (h) => (
                  <th
                    key={h}
                    className="px-3 py-2.5 text-left text-zinc-500 font-medium text-[10px] uppercase tracking-wider"
                  >
                    {h}
                  </th>
                )
              )}
            </tr>
          </thead>
          <tbody>
            {orders.map((o) => (
              <OrderRow
                key={o.id}
                order={o}
                onClick={() => navigate(`/admin/v2/orders/${o.id}`)}
              />
            ))}
            {orders.length === 0 && (
              <tr>
                <td colSpan={8} className="px-3 py-6 text-center text-zinc-500 text-sm">
                  No orders yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </SurfaceCard>
    </div>
  );
}

function OrderRow({
  order,
  onClick,
}: {
  order: OrderDetail;
  onClick: () => void;
}) {
  const alert =
    order.status === "needs_allocation" || order.status === "return_pending";
  const customerName = order.customer?.name ?? "Cash Sales";
  const isCashSales = !order.customer || customerName === "Cash Sales";

  const formattedDate = new Date(order.createdAt).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });

  return (
    <tr
      onClick={onClick}
      className="border-b border-zinc-200 cursor-pointer hover:bg-zinc-50 transition-colors"
      style={{
        background: alert ? "rgba(245,158,11,0.025)" : "transparent",
      }}
    >
      <td className="px-3 py-2.5">
        <Mono color="amber">{order.orderNumber}</Mono>
      </td>
      <td className="px-3 py-2.5 text-zinc-900">
        {customerName}
        {isCashSales && order.status === "needs_allocation" && (
          <span className="text-[10px] text-amber-500 ml-1.5">⚠ Allocate</span>
        )}
      </td>
      <td className="px-3 py-2.5 text-zinc-600">{order.channel}</td>
      <td className="px-3 py-2.5 text-zinc-600">{order.lineItems.length}</td>
      <td className="px-3 py-2.5">
        <Mono color="teal">£{order.total.toFixed(2)}</Mono>
      </td>
      <td className="px-3 py-2.5">
        <Mono color="dim">£{order.vatAmount.toFixed(2)}</Mono>
      </td>
      <td className="px-3 py-2.5">
        <OrderStatusBadge status={order.status} />
      </td>
      <td className="px-3 py-2.5 text-zinc-500">{formattedDate}</td>
    </tr>
  );
}
