import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useProduct, useUpdateSKUPrice } from "@/hooks/admin/use-products";
import { SurfaceCard, Mono, GradeBadge, BackButton } from "./ui-primitives";
import { StockUnitsTab } from "./StockUnitsTab";
import { CopyMediaTab } from "./CopyMediaTab";
import { ChannelsTab } from "./ChannelsTab";
import { SpecificationsTab } from "./SpecificationsTab";
import { toast } from "sonner";
import type { ProductVariant } from "@/lib/types/admin";

interface ProductDetailProps {
  mpn: string;
}

type TabKey = "stock" | "copy" | "channels" | "specs";

// ─── Inline editable price cell ──────────────────────────────

function PriceCell({ variant, mpn }: { variant: ProductVariant; mpn: string }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");
  const updatePrice = useUpdateSKUPrice();

  const startEdit = () => {
    setValue(variant.salePrice?.toFixed(2) ?? "");
    setEditing(true);
  };

  const save = async () => {
    const num = parseFloat(value);
    if (isNaN(num) || num <= 0) {
      toast.error("Enter a valid price");
      return;
    }
    try {
      await updatePrice.mutateAsync({
        skuId: variant.id,
        mpn,
        price: num,
        floorPrice: variant.floorPrice,
      });
      toast.success(`${variant.sku} price set to £${num.toFixed(2)}`);
      setEditing(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update price");
    }
  };

  const cancel = () => setEditing(false);

  const belowFloor =
    editing &&
    variant.floorPrice != null &&
    parseFloat(value) > 0 &&
    parseFloat(value) < variant.floorPrice;

  if (editing) {
    return (
      <div>
        <div className="text-[10px] text-zinc-500">Price</div>
        <div className="flex items-center gap-1 mt-0.5">
          <span className="text-xs text-zinc-400">£</span>
          <input
            type="text"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") save();
              if (e.key === "Escape") cancel();
            }}
            autoFocus
            className={`w-16 px-1.5 py-0.5 text-xs font-mono border rounded bg-white text-right focus:outline-none focus:ring-1 ${
              belowFloor
                ? "border-red-400 focus:ring-red-400 text-red-600"
                : "border-amber-300 focus:ring-amber-400"
            }`}
          />
        </div>
        {belowFloor && (
          <div className="text-[9px] text-red-500 mt-0.5">
            Below floor £{variant.floorPrice!.toFixed(2)}
          </div>
        )}
        <div className="flex gap-1 mt-1">
          <button
            onClick={save}
            disabled={updatePrice.isPending || !!belowFloor}
            className="text-[9px] text-amber-600 hover:text-amber-500 font-medium disabled:text-zinc-400"
          >
            {updatePrice.isPending ? "..." : "Save"}
          </button>
          <button
            onClick={cancel}
            className="text-[9px] text-zinc-400 hover:text-zinc-600"
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="text-[10px] text-zinc-500">Price</div>
      <button
        onClick={startEdit}
        className="bg-transparent border-none cursor-pointer p-0 hover:opacity-70 transition-opacity"
        title="Click to edit price"
      >
        <Mono color="teal" className="text-sm">
          {variant.salePrice ? `£${variant.salePrice.toFixed(2)}` : "—"}
        </Mono>
      </button>
    </div>
  );
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
    { key: "copy", label: "Copy & Media" },
    { key: "channels", label: "Channels" },
    { key: "specs", label: "Specifications" },
  ];

  return (
    <div>
      <BackButton onClick={() => navigate("/admin/products")} label="Back to products" />

      {/* Header */}
      <div className="mb-5">
        <div className="flex items-center gap-3 mb-1.5 flex-wrap">
          <h1 className="text-[22px] font-bold text-zinc-900">{product.name}</h1>
          <Mono color="amber" className="text-sm">{product.mpn}</Mono>
        </div>
        <div className="text-zinc-500 text-[13px]">
          Theme: {product.theme ?? "\u2014"}
        </div>
      </div>

      {/* Variant summary cards */}
      {product.variants.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
          {product.variants.map((v) => (
            <SurfaceCard key={v.sku} className="p-3.5">
              <div className="flex items-center justify-between mb-2.5">
                <Mono color="amber" className="text-[13px]">{v.sku}</Mono>
                <GradeBadge grade={v.grade} size="md" />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <PriceCell variant={v} mpn={mpn} />
                <div>
                  <div className="text-[10px] text-zinc-500">Avg Cost</div>
                  <Mono className="text-sm">
                    {v.avgCost ? `£${v.avgCost.toFixed(2)}` : "\u2014"}
                  </Mono>
                </div>
                <div>
                  <div className="text-[10px] text-zinc-500">Floor</div>
                  <Mono color="red" className="text-sm">
                    {v.floorPrice ? `£${v.floorPrice.toFixed(2)}` : "\u2014"}
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
                    {v.marketPrice ? `£${v.marketPrice.toFixed(2)}` : "\u2014"}
                  </Mono>
                </div>
              </div>
            </SurfaceCard>
          ))}
        </div>
      )}

      {/* Tab bar */}
      <div className="flex gap-0 border-b border-zinc-200 mb-5 overflow-x-auto whitespace-nowrap">
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
      {activeTab === "channels" && <ChannelsTab variants={product.variants} product={product} />}
      {activeTab === "specs" && <SpecificationsTab product={product} />}
    </div>
  );
}
