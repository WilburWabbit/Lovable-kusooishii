import { useParams } from "react-router-dom";
import { AdminV2Layout } from "@/components/admin-v2/AdminV2Layout";
import { BatchDetail } from "@/components/admin-v2/BatchDetail";

export default function BatchDetailPage() {
  const { batchId } = useParams<{ batchId: string }>();

  return (
    <AdminV2Layout>
      <BatchDetail batchId={batchId!} />
    </AdminV2Layout>
  );
}
