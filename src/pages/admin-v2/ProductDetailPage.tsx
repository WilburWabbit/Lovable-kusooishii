import { useParams } from "react-router-dom";
import { AdminV2Layout } from "@/components/admin-v2/AdminV2Layout";
import { ProductDetail } from "@/components/admin-v2/ProductDetail";

export default function ProductDetailPage() {
  const { mpn } = useParams<{ mpn: string }>();

  return (
    <AdminV2Layout>
      <ProductDetail mpn={mpn!} />
    </AdminV2Layout>
  );
}
