import { useNavigate } from "react-router-dom";
import { useProducts, useProductStockCounts } from "@/hooks/admin/use-products";
import type { Product, ProductVariant } from "@/lib/types/admin";
import { SurfaceCard, Mono, Badge, GradeBadge } from "./ui-primitives";

export function ProductList() {
  const navigate = useNavigate();
  const { data: products = [], isLoading } = useProducts();
  const { data: stockCounts } = useProductStockCounts();

  if (isLoading) {
    return <p className="text-zinc-500 text-sm">Loading products…</p>;
  }

  return (
    <div>
      <h1 className="text-[22px] font-bold text-zinc-50 mb-1">Products</h1>
      <p className="text-zinc-500 text-[13px] mb-5">
        {products.length} products (MPN level)
      </p>

      <SurfaceCard noPadding className="overflow-hidden">
        <table className="w-full border-collapse text-[13px]">
          <thead>
            <tr className="border-b border-zinc-700/80">
              {["MPN", "Product", "Theme", "Variants", "Total Units", "Listed", "Sold", "Status"].map((h) => (
                <th
                  key={h}
                  className="px-3 py-2.5 text-left text-zinc-500 font-medium text-[10px] uppercase tracking-wider"
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {products.map((p) => (
              <ProductRow
                key={p.mpn}
                product={p}
                variants={p.variants}
                listedCount={stockCounts?.get(p.mpn)?.listed ?? 0}
                soldCount={stockCounts?.get(p.mpn)?.sold ?? 0}
                onClick={() => navigate(`/admin/v2/products/${p.mpn}`)}
              />
            ))}
          </tbody>
        </table>
      </SurfaceCard>
    </div>
  );
}

function ProductRow({
  product,
  variants,
  listedCount,
  soldCount,
  onClick,
}: {
  product: Product;
  variants: ProductVariant[];
  listedCount: number;
  soldCount: number;
  onClick: () => void;
}) {
  const totalUnits = variants.reduce((s, v) => s + v.qtyOnHand, 0);
  const noVariants = variants.length === 0;

  return (
    <tr
      onClick={onClick}
      className="border-b border-zinc-700/80 cursor-pointer hover:bg-[#35353A] transition-colors"
    >
      <td className="px-3 py-2.5">
        <Mono color="amber">{product.mpn}</Mono>
      </td>
      <td className="px-3 py-2.5 text-zinc-50 font-medium">{product.name}</td>
      <td className="px-3 py-2.5 text-zinc-400">{product.theme ?? "—"}</td>
      <td className="px-3 py-2.5">
        <div className="flex gap-1">
          {variants.length > 0 ? (
            variants.map((v) => <GradeBadge key={v.sku} grade={v.grade} />)
          ) : (
            <span className="text-zinc-500 text-xs">—</span>
          )}
        </div>
      </td>
      <td className="px-3 py-2.5">
        <Mono>{totalUnits || "—"}</Mono>
      </td>
      <td className="px-3 py-2.5">
        <Mono color={listedCount > 0 ? "amber" : "dim"}>{listedCount}</Mono>
      </td>
      <td className="px-3 py-2.5">
        <Mono color={soldCount > 0 ? "green" : "dim"}>{soldCount}</Mono>
      </td>
      <td className="px-3 py-2.5">
        {noVariants ? (
          <Badge label="Ungraded" color="#F59E0B" small />
        ) : (
          <Badge label={`${variants.length} active`} color="#22C55E" small />
        )}
      </td>
    </tr>
  );
}
