import { useParams } from "react-router-dom";
import { AdminV2Layout } from "@/components/admin-v2/AdminV2Layout";
import { OrderDetail } from "@/components/admin-v2/OrderDetail";

export default function OrderDetailPage() {
  const { orderId } = useParams<{ orderId: string }>();

  return (
    <AdminV2Layout>
      <OrderDetail orderId={orderId!} />
    </AdminV2Layout>
  );
}
