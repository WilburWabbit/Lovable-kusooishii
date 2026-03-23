import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useProduct } from "@/hooks/admin/use-products";
import { SurfaceCard, Mono, GradeBadge, BackButton } from "./ui-primitives";
import { StockUnitsTab } from "./StockUnitsTab";
import { CopyMediaTab } from "./CopyMediaTab";
import { ChannelsTab } from "./ChannelsTab";
import { SpecificationsTab } from "./SpecificationsTab";

interface ProductDetailProps {
  mpn: string;
}

type TabKey = "stock" | "copy" | "channels" | "specs";

export function ProductDetail({ mpn }: ProductDetailProps) {
  const navigate = useNavigate();
  const { data: product, isLoading } = useProduct(mpn);
  const [activeTab, setActiveTab] = useState<TabKey>("stock");

  if (isLoading) {
    return <p className="text-zinc-500 text-sm">Loading product…</p>;
  }

  if (!product) {
    return <p className="text-zinc-500 text-sm">Product not found.</p>;
  }

  const totalUnits = product.variants.reduce((s, v) => s + v.qtyOnHand, 0);

  const tabs: { key: TabKey; label: string; count?: number }[] = [
    { key: "stock", label: "Stock Units", count: totalUnits },
    { key: "copy", label: "Copy & Media" },
    { key: "channels", label: "Channels" },
    { key: "specs", label: "Specifications" },
  ];

  return (
    <div>
      <BackButton onClick={() => navigate("/admin/v2/products")} label="Back to products" />

      {/* Header */}
      <div className="flex items-start justify-between mb-5">
        <div>
          <div className="flex items-center gap-3 mb-1.5">
            <h1 className="text-[22px] font-bold text-zinc-900">{product.name}</h1>
            <Mono color="amber" className="text-sm">{product.mpn}</Mono>
          </div>
          <div className="text-zinc-500 text-[13px]">
            Theme: {product.theme ?? "—"}
          </div>
        </div>
      </div>

      {/* Variant summary cards */}
      {product.variants.length > 0 && (
        <div
          className="grid gap-3 mb-5"
          style={{
            gridTemplateColumns: `repeat(${Math.min(product.variants.length, 4)}, 1fr)`,
          }}
        >
          {product.variants.map((v) => (
            <SurfaceCard key={v.sku} className="p-3.5">
              <div className="flex items-center justify-between mb-2.5">
                <Mono color="amber" className="text-[13px]">{v.sku}</Mono>
                <GradeBadge grade={v.grade} size="md" />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <div className="text-[10px] text-zinc-500">Price</div>
                  <Mono color="teal" className="text-sm">
                    {v.salePrice ? `£${v.salePrice.toFixed(2)}` : "—"}
                  </Mono>
                </div>
                <div>
                  <div className="text-[10px] text-zinc-500">Avg Cost</div>
                  <Mono className="text-sm">
                    {v.avgCost ? `£${v.avgCost.toFixed(2)}` : "—"}
                  </Mono>
                </div>
                <div>
                  <div className="text-[10px] text-zinc-500">Floor</div>
                  <Mono color="red" className="text-sm">
                    {v.floorPrice ? `£${v.floorPrice.toFixed(2)}` : "—"}
                  </Mono>
                </div>
                <div>
                  <div className="text-[10px] text-zinc-500">On Hand</div>
                  <Mono className="text-sm">{v.qtyOnHand}</Mono>
                </div>
                <div>
                  <div className="text-[10px] text-zinc-500">Cost Range</div>
                  <Mono className="text-[11px]">{v.costRange ?? "—"}</Mono>
                </div>
                <div>
                  <div className="text-[10px] text-zinc-500">Market</div>
                  <Mono className="text-sm">
                    {v.marketPrice ? `£${v.marketPrice.toFixed(2)}` : "—"}
                  </Mono>
                </div>
              </div>
            </SurfaceCard>
          ))}
        </div>
      )}

      {/* Tab bar */}
      <div className="flex gap-0 border-b border-zinc-200 mb-5">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setActiveTab(t.key)}
            className="px-4 py-2.5 bg-transparent border-none text-[13px] cursor-pointer flex items-center gap-1.5 transition-colors"
            style={{
              borderBottom: activeTab === t.key ? "2px solid #F59E0B" : "2px solid transparent",
              color: activeTab === t.key ? "#18181B" : "#71717A",
              fontWeight: activeTab === t.key ? 600 : 400,
            }}
          >
            {t.label}
            {t.count !== undefined && (
              <span className="text-[11px] text-zinc-500 bg-zinc-200 px-1.5 py-px rounded-full">
                {t.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {activeTab === "stock" && <StockUnitsTab mpn={mpn} />}
      {activeTab === "copy" && <CopyMediaTab product={product} />}
      {activeTab === "channels" && <ChannelsTab variants={product.variants} />}
      {activeTab === "specs" && <SpecificationsTab product={product} />}
    </div>
  );
}
