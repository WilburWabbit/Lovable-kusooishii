import type { ProductDetail } from "@/lib/types/admin";
import { PhotosSection } from "../CopyMediaTab";

interface PhotosTabProps {
  product: ProductDetail;
}

export function PhotosTab({ product }: PhotosTabProps) {
  return (
    <div className="grid gap-4">
      <PhotosSection product={product} />
    </div>
  );
}
