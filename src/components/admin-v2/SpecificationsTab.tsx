import type { Product } from "@/lib/types/admin";
import { SurfaceCard, SectionHead } from "./ui-primitives";

interface SpecificationsTabProps {
  product: Product;
}

export function SpecificationsTab({ product }: SpecificationsTabProps) {
  const specs: [string, string | null][] = [
    ["Set Number", product.setNumber ?? product.mpn.split("-")[0]],
    ["Theme", product.theme],
    ["Pieces", product.pieceCount?.toString() ?? null],
    ["Age Mark", product.ageMark],
    ["EAN", product.ean],
    ["Released", product.releaseDate],
    ["Retired", product.retiredDate],
    ["Dimensions", product.dimensionsCm],
    ["Weight", product.weightG ? `${product.weightG}g` : null],
  ];

  return (
    <SurfaceCard>
      <SectionHead>Product Specifications</SectionHead>
      <div className="grid grid-cols-2 gap-0">
        {specs.map(([label, value]) => (
          <div
            key={label}
            className="flex justify-between py-2 border-b border-zinc-200 mr-4"
          >
            <span className="text-zinc-500 text-[13px]">{label}</span>
            <span
              className="text-[13px]"
              style={{
                color: value ? "#18181B" : "rgba(245,158,11,0.56)",
              }}
            >
              {value ?? "To be confirmed"}
            </span>
          </div>
        ))}
      </div>
    </SurfaceCard>
  );
}
