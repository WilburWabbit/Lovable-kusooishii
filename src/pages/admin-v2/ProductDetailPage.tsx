import { useParams } from "react-router-dom";
import { AdminV2Layout } from "@/components/admin-v2/AdminV2Layout";

export default function ProductDetailPage() {
  const { mpn } = useParams<{ mpn: string }>();

  return (
    <AdminV2Layout>
      <div>
        <h1 className="text-[22px] font-bold text-zinc-50 mb-1">Product {mpn}</h1>
        <p className="text-zinc-500 text-[13px]">Product detail with variants, stock units, copy, channels, and specs.</p>
      </div>
    </AdminV2Layout>
  );
}
