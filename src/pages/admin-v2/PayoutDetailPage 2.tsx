import { useParams } from "react-router-dom";
import { AdminV2Layout } from "@/components/admin-v2/AdminV2Layout";
import { PayoutDetail } from "@/components/admin-v2/PayoutDetail";

export default function PayoutDetailPage() {
  const { payoutId } = useParams<{ payoutId: string }>();

  return (
    <AdminV2Layout>
      <PayoutDetail payoutId={payoutId!} />
    </AdminV2Layout>
  );
}
