import { useParams } from "react-router-dom";
import { AdminV2Layout } from "@/components/admin-v2/AdminV2Layout";

export default function BatchDetailPage() {
  const { batchId } = useParams<{ batchId: string }>();

  return (
    <AdminV2Layout>
      <div>
        <h1 className="text-[22px] font-bold text-zinc-50 mb-1">Batch {batchId}</h1>
        <p className="text-zinc-500 text-[13px]">Batch detail with line items and stock units.</p>
      </div>
    </AdminV2Layout>
  );
}
