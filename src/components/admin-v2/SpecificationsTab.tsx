import type { ProductDetail } from "@/lib/types/admin";
import { SurfaceCard, SectionHead } from "./ui-primitives";
import { CanonicalSpecsCard } from "./CanonicalSpecsCard";
import { ChannelMappingCard } from "./ChannelMappingCard";
import { useQueryClient } from "@tanstack/react-query";
import { productKeys } from "@/hooks/admin/use-products";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface SpecificationsTabProps {
  product: ProductDetail;
}

export function SpecificationsTab({ product }: SpecificationsTabProps) {
  const queryClient = useQueryClient();

  const handleCatalogToggle = async (checked: boolean) => {
    try {
      const { error } = await supabase
        .from("product")
        .update({ include_catalog_img: checked } as never)
        .eq("id", product.id);
      if (error) throw error;
      toast.success(checked ? "Catalog image included" : "Catalog image excluded");
      queryClient.invalidateQueries({ queryKey: productKeys.detail(product.mpn) });
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Update failed");
    }
  };

  return (
    <div className="grid gap-4">
      <CanonicalSpecsCard product={product} />
      <ChannelMappingCard product={product} />

      {/* Catalog Image */}
      {product.catalogImageUrl && (
        <SurfaceCard>
          <SectionHead>Catalog Image</SectionHead>
          <div className="flex items-start gap-4">
            <div className="w-24 h-24 rounded border border-dashed border-zinc-300 overflow-hidden bg-zinc-50 flex-shrink-0">
              <img
                src={product.catalogImageUrl}
                alt={`${product.name} catalog`}
                className="w-full h-full object-contain"
              />
            </div>
            <div>
              <label className="flex items-center gap-2 text-[13px] text-zinc-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={product.includeCatalogImg}
                  onChange={(e) => handleCatalogToggle(e.target.checked)}
                  className="accent-amber-500"
                />
                Include in listings
              </label>
              <p className="text-[11px] text-zinc-500 mt-1">
                When enabled, this image from the LEGO catalog will be included
                alongside your uploaded product photos.
              </p>
            </div>
          </div>
        </SurfaceCard>
      )}
    </div>
  );
}
