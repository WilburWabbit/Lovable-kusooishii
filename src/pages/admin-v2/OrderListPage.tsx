import { AdminV2Layout } from "@/components/admin-v2/AdminV2Layout";

export default function OrderListPage() {
  return (
    <AdminV2Layout>
      <div>
        <h1 className="text-[22px] font-bold text-zinc-50 mb-1">Orders</h1>
        <p className="text-zinc-500 text-[13px]">All orders with line items and stock unit details.</p>
      </div>
    </AdminV2Layout>
  );
}
