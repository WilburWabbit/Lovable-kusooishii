import { useState, useMemo } from "react";
import {
  useChannelListings,
  useChannelFees,
  usePublishListing,
  calculateChannelPrice,
} from "@/hooks/admin/use-channel-listings";
import { CHANNEL_LISTING_STATUSES } from "@/lib/constants/unit-statuses";
import type { ProductVariant, Product, Channel, ChannelListing } from "@/lib/types/admin";
import { SurfaceCard, Mono, Badge, GradeBadge, SectionHead } from "./ui-primitives";
import { toast } from "sonner";
import { generateEbayTitle } from "@/lib/utils/generate-ebay-title";

interface ChannelsTabProps {
  variants: ProductVariant[];
  product: Product;
}

const CHANNELS: { key: Channel; label: string; titleLimit: number }[] = [
  { key: "ebay", label: "eBay", titleLimit: 80 },
  { key: "website", label: "Website", titleLimit: 200 },
  { key: "bricklink", label: "BrickLink", titleLimit: 200 },
  { key: "brickowl", label: "BrickOwl", titleLimit: 200 },
];

export function ChannelsTab({ variants, product }: ChannelsTabProps) {
  const { data: feesMap } = useChannelFees();

  return (
    <div className="grid gap-4">
      {variants.map((v) => (
        <VariantChannelsCard key={v.sku} variant={v} feesMap={feesMap} product={product} />
      ))}
    </div>
  );
}

function VariantChannelsCard({
  variant,
  feesMap,
  product,
}: {
  variant: ProductVariant;
  feesMap: Map<string, { totalFeeRate: number; fees: { name: string; rate: number; fixed: number }[] }> | undefined;
  product: Product;
}) {
  const { data: listings = [] } = useChannelListings(variant.sku);
  const publishListing = usePublishListing();

  const listingsByChannel = useMemo(() => {
    const map = new Map<string, ChannelListing>();
    for (const l of listings) map.set(l.channel, l);
    return map;
  }, [listings]);

  // Generate Cassini-optimised eBay title from product metadata
  const defaultEbayTitle = useMemo(() => {
    const retiredYear = product.retiredDate
      ? new Date(product.retiredDate).getFullYear()
      : null;
    return generateEbayTitle({
      name: product.name,
      mpn: product.mpn,
      theme: product.theme,
      grade: variant.grade,
      retired: !!product.retiredDate,
      retiredYear,
      pieceCount: product.pieceCount,
    }).title;
  }, [product, variant.grade]);

  // Per-channel local state for title, description, price
  const [channelState, setChannelState] = useState<
    Record<string, { title: string; description: string; price: string }>
  >(() => {
    const initial: Record<string, { title: string; description: string; price: string }> = {};
    for (const ch of CHANNELS) {
      const existing = listings.find((l) => l.channel === ch.key);
      const feeInfo = feesMap?.get(ch.key);
      const basePrice = variant.salePrice ?? 0;
      const feeCalc = calculateChannelPrice(basePrice, variant.floorPrice, feeInfo);

      initial[ch.key] = {
        title: existing?.listingTitle ?? (ch.key === "ebay" ? defaultEbayTitle : product.name),
        description: existing?.listingDescription ?? "",
        price: existing?.listingPrice?.toFixed(2) ?? feeCalc.suggestedPrice.toFixed(2),
      };
    }
    return initial;
  });

  const updateField = (channel: string, field: "title" | "description" | "price", value: string) => {
    setChannelState((prev) => ({
      ...prev,
      [channel]: { ...prev[channel], [field]: value },
    }));
  };

  const handlePublish = async (ch: { key: Channel; label: string }) => {
    const state = channelState[ch.key];
    if (!state?.title?.trim()) {
      toast.error(`${ch.label} listing title is required`);
      return;
    }

    const price = parseFloat(state.price);
    if (isNaN(price) || price <= 0) {
      toast.error("Invalid price");
      return;
    }

    const feeInfo = feesMap?.get(ch.key);
    const feeCalc = calculateChannelPrice(price, variant.floorPrice, feeInfo);

    try {
      await publishListing.mutateAsync({
        skuCode: variant.sku,
        channel: ch.key,
        listingTitle: state.title.trim(),
        listingDescription: state.description.trim() || undefined,
        listingPrice: price,
        estimatedFees: feeCalc.estimatedFees,
        estimatedNet: feeCalc.estimatedNet,
      });
      toast.success(`Published ${variant.sku} to ${ch.label}`);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Publish failed";
      toast.error(message);
    }
  };

  return (
    <SurfaceCard>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2.5">
          <Mono color="amber" className="text-sm">{variant.sku}</Mono>
          <GradeBadge grade={variant.grade} size="md" />
          <Mono color="teal">
            {variant.salePrice ? `£${variant.salePrice.toFixed(2)}` : "—"}
          </Mono>
          {variant.floorPrice && (
            <span className="text-[10px] text-zinc-500">
              Floor: <Mono color="red" className="text-[10px]">£{variant.floorPrice.toFixed(2)}</Mono>
            </span>
          )}
        </div>
      </div>

      <div className="grid gap-3">
        {CHANNELS.map((ch) => {
          const listing = listingsByChannel.get(ch.key);
          const status = listing?.status ?? "draft";
          const statusInfo = CHANNEL_LISTING_STATUSES[status];
          const state = channelState[ch.key] ?? { title: "", description: "", price: "0" };
          const price = parseFloat(state.price) || 0;
          const feeInfo = feesMap?.get(ch.key);
          const feeCalc = calculateChannelPrice(price, variant.floorPrice, feeInfo);
          const belowFloor = variant.floorPrice != null && price > 0 && price < variant.floorPrice;
          const titleEmpty = !state.title?.trim();
          const canPublish = !titleEmpty && !belowFloor && price > 0;

          // Check if live listing has fallen below floor
          const liveAndBelowFloor = status === "live" && listing?.listingPrice != null
            && variant.floorPrice != null && listing.listingPrice < variant.floorPrice;

          return (
            <div
              key={ch.key}
              className="p-3.5 bg-zinc-50 rounded-lg border border-zinc-200"
            >
              {/* Channel header */}
              <div className="flex justify-between items-center mb-2.5">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold text-zinc-900">{ch.label}</span>
                  <Badge label={statusInfo.label} color={statusInfo.color} small />
                  {liveAndBelowFloor && (
                    <Badge label="Below floor" color="#EF4444" small />
                  )}
                </div>
              </div>

              {/* Title */}
              <div className="mb-2">
                <label className="text-[10px] text-zinc-500 font-semibold uppercase tracking-wider block mb-0.5">
                  Title <span className="text-zinc-600 font-normal">({state.title.length}/{ch.titleLimit})</span>
                  {titleEmpty && <span className="text-red-500 ml-1">*required</span>}
                </label>
                <input
                  value={state.title}
                  onChange={(e) => updateField(ch.key, "title", e.target.value)}
                  maxLength={ch.titleLimit}
                  placeholder={`${ch.label} listing title`}
                  className="w-full px-2 py-1.5 bg-white border border-zinc-200 rounded text-zinc-900 text-xs"
                />
              </div>

              {/* Description override */}
              <div className="mb-2">
                <label className="text-[10px] text-zinc-500 font-semibold uppercase tracking-wider block mb-0.5">
                  Description <span className="text-zinc-600 font-normal">(override)</span>
                </label>
                <textarea
                  value={state.description}
                  onChange={(e) => updateField(ch.key, "description", e.target.value)}
                  rows={2}
                  placeholder="Leave blank to use mastered copy"
                  className="w-full px-2 py-1.5 bg-white border border-zinc-200 rounded text-zinc-900 text-xs resize-y font-sans"
                />
              </div>

              {/* Price + fees */}
              <div className="grid grid-cols-3 gap-2 mb-2">
                <div>
                  <label className="text-[10px] text-zinc-500 font-semibold uppercase tracking-wider block mb-0.5">
                    Price (£)
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={state.price}
                    onChange={(e) => updateField(ch.key, "price", e.target.value)}
                    className={`w-full px-2 py-1.5 bg-white border rounded text-xs font-mono ${
                      belowFloor ? "border-red-500 text-red-400" : "border-zinc-200 text-zinc-900"
                    }`}
                  />
                </div>
                <div>
                  <label className="text-[10px] text-zinc-500 font-semibold uppercase tracking-wider block mb-0.5">
                    Est. Fees
                  </label>
                  <div className="px-2 py-1.5 text-xs font-mono text-red-400">
                    £{feeCalc.estimatedFees.toFixed(2)}
                  </div>
                </div>
                <div>
                  <label className="text-[10px] text-zinc-500 font-semibold uppercase tracking-wider block mb-0.5">
                    Net
                  </label>
                  <div className="px-2 py-1.5 text-xs font-mono text-teal-500">
                    £{feeCalc.estimatedNet.toFixed(2)}
                  </div>
                </div>
              </div>

              {/* Warnings */}
              {belowFloor && (
                <div className="text-[11px] text-red-500 mb-2">
                  Below floor price (£{variant.floorPrice!.toFixed(2)})
                </div>
              )}

              {/* Fee breakdown tooltip */}
              {feeInfo && feeInfo.fees.length > 0 && (
                <div className="text-[10px] text-zinc-600 mb-2">
                  Fees: {feeInfo.fees.map((f) => `${f.name} ${(f.rate * 100).toFixed(1)}%`).join(" + ")}
                  {feeInfo.totalFeeRate > 0 && ` = ${(feeInfo.totalFeeRate * 100).toFixed(1)}% total`}
                </div>
              )}

              {/* Publish */}
              <button
                onClick={() => handlePublish(ch)}
                disabled={!canPublish || publishListing.isPending}
                className="w-full py-1.5 rounded text-[11px] font-semibold cursor-pointer transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                style={{
                  background: canPublish ? "#22C55E" : "#E4E4E7",
                  color: canPublish ? "#18181B" : "#71717A",
                  border: canPublish ? "none" : "1px solid #D4D4D8",
                }}
              >
                {publishListing.isPending ? "Publishing…" : status === "live" ? "Update Listing" : "Publish"}
              </button>
            </div>
          );
        })}
      </div>
    </SurfaceCard>
  );
}
