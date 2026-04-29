import type { ProductDetail } from "@/lib/types/admin";
import { CopySection, ConditionNotesSection } from "../CopyMediaTab";

interface CopyTabProps {
  product: ProductDetail;
}

export function CopyTab({ product }: CopyTabProps) {
  return (
    <div className="grid gap-4">
      <CopySection product={product} />
      {product.variants.map((v) => (
        <ConditionNotesSection key={v.sku} variant={v} product={product} />
      ))}
    </div>
  );
}
