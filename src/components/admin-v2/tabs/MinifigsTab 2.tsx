import type { ProductDetail } from "@/lib/types/admin";
import { MinifigsCard } from "../MinifigsCard";

interface MinifigsTabProps {
  product: ProductDetail;
}

export function MinifigsTab({ product }: MinifigsTabProps) {
  return (
    <div className="grid gap-4">
      <MinifigsCard product={product} />
    </div>
  );
}
