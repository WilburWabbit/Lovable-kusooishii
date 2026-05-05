import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useProduct } from "@/hooks/admin/use-products";
import { SurfaceCard, Mono, GradeBadge, BackButton } from "./ui-primitives";
import { StockUnitsTab } from "./StockUnitsTab";
import { PhotosTab } from "./tabs/PhotosTab";
import { CopyTab } from "./tabs/CopyTab";
import { MinifigsTab } from "./tabs/MinifigsTab";
import { ChannelsTab } from "./ChannelsTab";
import { PricingTransparencyTab } from "./PricingTransparencyTab";
import { SpecificationsTab } from "./SpecificationsTab";
import { BrickEconomyPriceChart } from "./BrickEconomyPriceChart";
import type { Channel, ProductVariant, ProductVariantPricing } from "@/lib/types/admin";

interface ProductDetailProps {
  mpn: string;
}

type TabKey = "stock" | "photos" | "copy" | "minifigs" | "pricing" | "channels" | "specs" | "market";
const HEADER_CHANNELS: Array<{ key: Channel; priceChannel: string; label: string }> = [
  { key: "website", priceChannel: "web", label: "Web" },
  { key: "ebay", priceChannel: "ebay", label: "eBay" },
  { key: "bricklink", priceChannel: "bricklink", label: "BrickLink" },
  { key: "brickowl", priceChannel: "brickowl", label: "BrickOwl" },
];

function normalizedPricingChannel(channel: string | null | undefined) {
  return channel === "website" ? "web" : channel;
}

function pricingForChannel(variant: ProductVariant, channel: string): ProductVariantPricing | undefined {
  return variant.channelPricing.find((pricing) => normalizedPricingChannel(pricing.channel) === channel);
}

function money(value: number | null | undefined) {
  return value == null || !Number.isFinite(Number(value)) ? "—" : `£${Number(value).toFixed(2)}`;
}

// ─── ProductDetail ───────────────────────────────────────────

export function ProductDetail({ mpn }: ProductDetailProps) {
  const navigate = useNavigate();
  const { data: product, isLoading } = useProduct(mpn);
  const [activeTab, setActiveTab] = useState<TabKey>("stock");

  if (isLoading) {
    return <p className="text-zinc-500 text-sm">Loading product...</p>;
  }

  if (!product) {
    return <p className="text-zinc-500 text-sm">Product not found.</p>;
  }

  const totalUnits = product.variants.reduce((s, v) => s + v.qtyOnHand, 0);

  const tabs: { key: TabKey; label: string; count?: number }[] = [
    { key: "stock", label: "Stock Units", count: totalUnits },
    { key: "photos", label: "Photos" },
    { key: "copy", label: "Copy & SEO" },
    { key: "minifigs", label: "Minifigs" },
    { key: "pricing", label: "Pricing" },
    { key: "channels", label: "Channels" },
    { key: "specs", label: "Specifications" },
    { key: "market", label: "Market Data" },
  ];

  return (
    <div>
      <BackButton onClick={() => navigate("/admin/products")} label="Back to products" />

      {/* Header */}
      <div className="flex items-start justify-between mb-5">
        <div>
          <div className="flex items-center gap-3 mb-1.5">
            <h1 className="text-[22px] font-bold text-zinc-900">{product.name}</h1>
            <Mono color="amber" className="text-sm">{product.mpn}</Mono>
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-zinc-500 text-[13px]">
            <span>Theme: {product.theme ?? "\u2014"}</span>
            <span>Brand: {product.brand ?? "\u2014"}</span>
            <span className="font-mono text-[11px] text-zinc-400">App: {product.id}</span>
            <span className="font-mono text-[11px] text-zinc-400">MPN: {product.mpn}</span>
            <span className="font-mono text-[11px] text-zinc-400">eBay Category: {product.ebayCategoryId ?? "\u2014"}</span>
          </div>
        </div>
      </div>

      {/* Variant summary cards */}
      {product.variants.length > 0 && (
        <div
          className="grid gap-3 mb-5"
          style={{
            gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
          }}
        >
          {product.variants.map((v) => (
            <SurfaceCard key={v.sku} className="p-3.5">
              <div className="flex items-center justify-between mb-2.5">
                <Mono color="amber" className="text-[13px]">{v.sku}</Mono>
                <GradeBadge grade={v.grade} size="md" />
              </div>
              <div className="grid grid-cols-2 gap-2 mb-3">
                <div>
                  <div className="text-[10px] text-zinc-500">Avg Cost</div>
                  <Mono className="text-sm">
                    {money(v.avgCost)}
                  </Mono>
                </div>
                <div>
                  <div className="text-[10px] text-zinc-500">On Hand</div>
                  <Mono className="text-sm">{v.qtyOnHand}</Mono>
                </div>
                <div>
                  <div className="text-[10px] text-zinc-500">Cost Range</div>
                  <Mono className="text-[11px]">{v.costRange ?? "\u2014"}</Mono>
                </div>
                <div>
                  <div className="text-[10px] text-zinc-500">Market</div>
                  <Mono className="text-sm">
                    {money(v.marketPrice)}
                  </Mono>
                </div>
              </div>
              <div className="grid gap-1.5">
                {HEADER_CHANNELS.map((channel) => {
                  const pricing = pricingForChannel(v, channel.priceChannel);
                  return (
                    <div
                      key={channel.key}
                      className="grid grid-cols-[72px_1fr_1fr] items-center gap-2 rounded border border-zinc-200 bg-zinc-50 px-2 py-1.5 text-[11px]"
                    >
                      <span className="font-semibold text-zinc-700">{channel.label}</span>
                      <span className="text-zinc-500">
                        Target <Mono color={pricing?.targetPrice ? "teal" : "amber"}>{money(pricing?.targetPrice)}</Mono>
                      </span>
                      <span className="text-zinc-500">
                        Floor <Mono color={pricing?.floorPrice ? "red" : "amber"}>{money(pricing?.floorPrice)}</Mono>
                      </span>
                    </div>
                  );
                })}
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
      {activeTab === "photos" && <PhotosTab product={product} />}
      {activeTab === "copy" && <CopyTab product={product} />}
      {activeTab === "minifigs" && <MinifigsTab product={product} />}
      {activeTab === "pricing" && <PricingTransparencyTab mpn={mpn} />}
      {activeTab === "channels" && <ChannelsTab variants={product.variants} product={product} />}
      {activeTab === "specs" && <SpecificationsTab product={product} />}
      {activeTab === "market" && <BrickEconomyPriceChart mpn={mpn} itemType={product.productType === "minifig" ? "minifig" : "set"} />}
    </div>
  );
}
