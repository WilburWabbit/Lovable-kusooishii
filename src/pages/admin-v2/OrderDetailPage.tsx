import { useParams } from "react-router-dom";
import { AdminV2Layout } from "@/components/admin-v2/AdminV2Layout";

export default function OrderDetailPage() {
  const { orderId } = useParams<{ orderId: string }>();

  return (
    <AdminV2Layout>
      <div>
        <h1 className="text-[22px] font-bold text-zinc-50 mb-1">Order {orderId}</h1>
        <p className="text-zinc-500 text-[13px]">Order detail with line items and stock unit status.</p>
      </div>
    </AdminV2Layout>
  );
}
