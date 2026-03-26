import { useNavigate, useParams } from "react-router-dom";
import { useCustomer, useCustomerOrders } from "@/hooks/admin/use-customers";
import type { CustomerOrderSummary } from "@/hooks/admin/use-customers";
import { SurfaceCard, Mono, Badge, BackButton, SectionHead, OrderStatusBadge } from "./ui-primitives";
import type { OrderStatus } from "@/lib/types/admin";

export function CustomerDetail() {
  const { customerId } = useParams<{ customerId: string }>();
  const navigate = useNavigate();
  const { data: customer, isLoading } = useCustomer(customerId);
  const { data: orders = [], isLoading: ordersLoading } = useCustomerOrders(customerId);

  if (isLoading) {
    return <p className="text-zinc-500 text-sm">Loading customer…</p>;
  }

  if (!customer) {
    return <p className="text-zinc-500 text-sm">Customer not found.</p>;
  }

  const formatDate = (iso: string | null) => {
    if (!iso) return "—";
    return new Date(iso).toLocaleDateString("en-GB", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  };

  const address = [
    customer.billingLine1,
    customer.billingLine2,
    customer.billingCity,
    customer.billingCounty,
    customer.billingPostcode,
    customer.billingCountry,
  ]
    .filter(Boolean)
    .join(", ");

  const channelEntries = Object.entries(customer.channelIds);

  return (
    <div>
      <BackButton onClick={() => navigate("/admin/customers")} label="Customers" />

      {/* Header */}
      <div className="flex items-center gap-3 mb-1">
        <h1 className="text-[22px] font-bold text-zinc-900">{customer.name}</h1>
        {customer.blueBellMember && <Badge label="Blue Bell" color="#3B82F6" small />}
        {!customer.active && <Badge label="Inactive" color="#71717A" small />}
      </div>
      <p className="text-zinc-500 text-[13px] mb-5">
        {customer.orderCount} orders · £{customer.totalSpend.toFixed(2)} total spend · Customer since {formatDate(customer.createdAt)}
      </p>

      {/* Info grid */}
      <SurfaceCard className="mb-5">
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          <InfoField label="Email" value={customer.email || "—"} />
          <InfoField label="Phone" value={customer.phone ?? "—"} />
          <InfoField label="Mobile" value={customer.mobile ?? "—"} />
          <InfoField label="Address" value={address || "—"} />
          <InfoField
            label="Channels"
            value={
              channelEntries.length > 0
                ? channelEntries.map(([ch, id]) => `${ch}: ${id}`).join(", ")
                : "—"
            }
          />
          <InfoField label="QBO Customer ID" value={customer.qboCustomerId ?? "—"} mono />
          {customer.notes && (
            <div className="col-span-full">
              <InfoField label="Notes" value={customer.notes} />
            </div>
          )}
        </div>
      </SurfaceCard>

      {/* Orders section */}
      <SectionHead>Orders</SectionHead>
      <SurfaceCard noPadding className="overflow-x-auto mt-2">
        {ordersLoading ? (
          <p className="text-zinc-500 text-sm p-4">Loading orders…</p>
        ) : orders.length === 0 ? (
          <p className="text-zinc-500 text-sm p-4">No orders for this customer.</p>
        ) : (
          <table className="w-full border-collapse text-[13px]">
            <thead>
              <tr className="border-b border-zinc-200">
                {["Order", "Channel", "Items", "Total", "Status", "Date"].map((h) => (
                  <th
                    key={h}
                    className="px-3 py-2.5 text-left text-zinc-500 font-medium text-[10px] uppercase tracking-wider"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {orders.map((o) => (
                <CustomerOrderRow
                  key={o.id}
                  order={o}
                  onClick={() => navigate(`/admin/orders/${o.id}`)}
                />
              ))}
            </tbody>
          </table>
        )}
      </SurfaceCard>
    </div>
  );
}

// ─── Sub-components ──────────────────────────────────────────

function InfoField({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div>
      <div className="text-[10px] text-zinc-500 uppercase tracking-wider mb-0.5">
        {label}
      </div>
      {mono ? (
        <Mono color="dim" className="text-sm">{value}</Mono>
      ) : (
        <div className="text-zinc-900 text-sm">{value}</div>
      )}
    </div>
  );
}

function CustomerOrderRow({
  order,
  onClick,
}: {
  order: CustomerOrderSummary;
  onClick: () => void;
}) {
  const formattedDate = new Date(order.createdAt).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });

  return (
    <tr
      onClick={onClick}
      className="border-b border-zinc-200 cursor-pointer hover:bg-zinc-50 transition-colors"
    >
      <td className="px-3 py-2.5">
        <Mono color="amber">{order.orderNumber}</Mono>
      </td>
      <td className="px-3 py-2.5 text-zinc-600">{order.channel}</td>
      <td className="px-3 py-2.5 text-zinc-600">{order.itemCount}</td>
      <td className="px-3 py-2.5">
        <Mono color="teal">£{order.total.toFixed(2)}</Mono>
      </td>
      <td className="px-3 py-2.5">
        <OrderStatusBadge status={order.status as OrderStatus} />
      </td>
      <td className="px-3 py-2.5 text-zinc-500">{formattedDate}</td>
    </tr>
  );
}
