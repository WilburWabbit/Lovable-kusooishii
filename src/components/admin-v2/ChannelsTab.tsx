import { useState, useMemo, useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  channelListingKeys,
  useChannelListings,
  useChannelFees,
  usePublishListing,
  useVariantChannelPricing,
  useWebsiteListingPreflight,
  useActivateSku,
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

function normalizedChannel(channel: Channel | string | null | undefined): Channel {
  if (channel === "web") return "website";
  return (channel ?? "website") as Channel;
}

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
  const { data: pricingByChannel, isLoading: pricingLoading } = useVariantChannelPricing(variant.id, variant.sku);
  const { data: webPreflight, isLoading: webPreflightLoading } = useWebsiteListingPreflight(variant.id);
  const publishListing = usePublishListing();
  const activateSku = useActivateSku();
  const queryClient = useQueryClient();

  const listingsByChannel = useMemo(() => {
    const map = new Map<string, ChannelListing>();
    for (const l of listings) map.set(normalizedChannel(l.channel), l);
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

  // Per-channel local state for title and description.
  // Tracks which fields the user has manually edited so async loads of
  // `listings`/`feesMap` don't clobber unsaved typing — but they DO populate
  // fields the user hasn't touched (the previous useState-only init left the
  // form stuck on default-generated values when listings arrived after first
  // render, causing the wrong title to be pushed to eBay).
  const dirtyRef = useRef<Record<string, { title: boolean; description: boolean }>>({});
  const [channelState, setChannelState] = useState<
    Record<string, { title: string; description: string; price: string }>
  >({});

  useEffect(() => {
    setChannelState((prev) => {
      const next: Record<string, { title: string; description: string; price: string }> = { ...prev };
      for (const ch of CHANNELS) {
        const existing = listings.find((l) => normalizedChannel(l.channel) === ch.key);
        const pricing = pricingByChannel?.get(ch.key);
        const quoteBelongsToVariant = !pricing || pricing.sku_id === variant.id;
        const dirty = dirtyRef.current[ch.key] ?? { title: false, description: false };
        const current = prev[ch.key];

        const defaultTitle = ch.key === "ebay" ? defaultEbayTitle : product.name;
        next[ch.key] = {
          title: dirty.title
            ? current?.title ?? ""
            : existing?.listingTitle ?? defaultTitle,
          description: dirty.description
            ? current?.description ?? ""
            : existing?.listingDescription ?? "",
          price: quoteBelongsToVariant
            ? pricing?.target_price?.toFixed(2) ?? existing?.listingPrice?.toFixed(2) ?? ""
            : existing?.listingPrice?.toFixed(2) ?? "",
        };
      }
      return next;
    });
  }, [listings, pricingByChannel, defaultEbayTitle, product.name, variant.id]);

  const updateField = (channel: string, field: "title" | "description", value: string) => {
    const channelDirty = dirtyRef.current[channel] ?? { title: false, description: false };
    dirtyRef.current[channel] = { ...channelDirty, [field]: true };
    setChannelState((prev) => ({
      ...prev,
      [channel]: {
        title: prev[channel]?.title ?? "",
        description: prev[channel]?.description ?? "",
        price: prev[channel]?.price ?? "",
        [field]: value,
      },
    }));
  };

  const handlePublish = async (ch: { key: Channel; label: string }) => {
    const state = channelState[ch.key];
    const pricing = pricingByChannel?.get(ch.key);
    if (pricing && pricing.sku_id !== variant.id) {
      toast.error(`${ch.label} pricing quote does not match ${variant.sku}`);
      return;
    }
    if (ch.key === "website" && webPreflight && !webPreflight.can_publish) {
      toast.error(webPreflight.blockers[0] ?? "Website listing is blocked");
      return;
    }
    if (!state?.title?.trim()) {
      toast.error(`${ch.label} listing title is required`);
      return;
    }

    const price = Number(pricing?.target_price ?? state.price);
    if (isNaN(price) || price <= 0) {
      toast.error("Calculated price is not available");
      return;
    }

    const floorPrice = pricing?.floor_price ?? null;
    if (floorPrice != null && price < floorPrice) {
      toast.error(`${ch.label} calculated target is below its channel floor`);
      return;
    }

    try {
      await publishListing.mutateAsync({
        skuCode: variant.sku,
        channel: ch.key,
        listingTitle: state.title.trim(),
        listingDescription: state.description.trim() || undefined,
        listingPrice: price,
        estimatedFees: pricing?.estimated_fees ?? undefined,
        estimatedNet: pricing?.estimated_net ?? undefined,
        allowBelowFloor: false,
      });
      toast.success(`Queued ${variant.sku} for ${ch.label}`);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Publish failed";
      toast.error(message);
    }
  };

  const refreshWebsitePreflight = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: channelListingKeys.pricingByVariant(variant.id) }),
      queryClient.invalidateQueries({ queryKey: channelListingKeys.websitePreflight(variant.id) }),
    ]);
  };

  return (
    <SurfaceCard>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2.5">
          <Mono color="amber" className="text-sm">{variant.sku}</Mono>
          <GradeBadge grade={variant.grade} size="md" />
          <Mono color="teal">
            {pricingLoading ? "Pricing..." : "Channel priced"}
          </Mono>
        </div>
      </div>

      <div className="grid gap-3">
        {CHANNELS.map((ch) => {
          const listing = listingsByChannel.get(ch.key);
          const status = listing?.status ?? "draft";
          const statusInfo = CHANNEL_LISTING_STATUSES[status];
          const state = channelState[ch.key] ?? { title: "", description: "", price: "0" };
          const feeInfo = feesMap?.get(ch.key) ?? (ch.key === "website" ? feesMap?.get("web") : undefined);
          const quote = pricingByChannel?.get(ch.key);
          const pricing = quote?.sku_id === variant.id ? quote : undefined;
          const price = Number(pricing?.target_price ?? state.price) || 0;
          const floorPrice = pricing?.floor_price ?? null;
          const estimatedFees = pricing?.estimated_fees ?? listing?.estimatedFees ?? null;
          const estimatedNet = pricing?.estimated_net ?? listing?.estimatedNet ?? null;
          const belowFloor = floorPrice != null && price > 0 && price < floorPrice;
          const titleEmpty = !state.title?.trim();
          const websiteBlocked = ch.key === "website" && webPreflight ? !webPreflight.can_publish : false;
          const preflightChecking = ch.key === "website" && webPreflightLoading;
          const canPublish = !pricingLoading && !webPreflightLoading && !titleEmpty && price > 0 && !belowFloor && !websiteBlocked;
          const stockCount = ch.key === "website" ? webPreflight?.saleable_stock_count : pricing?.stock_unit_count;
          const confidence = pricing?.confidence_score == null ? null : Math.round(Number(pricing.confidence_score) * 100);

          // Check if live listing has fallen below floor
          const liveAndBelowFloor = status === "live" && listing?.listingPrice != null
            && floorPrice != null && listing.listingPrice < floorPrice;

          return (
            <div
              key={ch.key}
              className="p-3.5 bg-zinc-50 rounded-lg border border-zinc-200"
            >
              {/* Channel header */}
              <div className="flex flex-wrap justify-between items-center gap-2 mb-2.5">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold text-zinc-900">{ch.label}</span>
                  <Badge label={statusInfo.label} color={statusInfo.color} small />
                  {preflightChecking && <Badge label="Checking" color="#71717A" small />}
                  {websiteBlocked && <Badge label="Action needed" color="#F59E0B" small />}
                  {liveAndBelowFloor && (
                    <Badge label="Below floor" color="#EF4444" small />
                  )}
                </div>
                <div className="flex items-center gap-2 text-[10px] text-zinc-500">
                  <span>Stock <Mono color={stockCount ? "teal" : "amber"}>{stockCount ?? "—"}</Mono></span>
                  <span>Confidence <Mono color={confidence != null && confidence >= 70 ? "teal" : "amber"}>{confidence == null ? "—" : `${confidence}%`}</Mono></span>
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
              <div className="grid grid-cols-1 gap-2 mb-2 sm:grid-cols-3">
                <div>
                  <label className="text-[10px] text-zinc-500 font-semibold uppercase tracking-wider block mb-0.5">
                    Price (£)
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={state.price}
                    readOnly
                    className={`w-full px-2 py-1.5 bg-zinc-50 border rounded text-xs font-mono ${
                      belowFloor ? "border-red-500 text-red-400" : "border-zinc-200 text-zinc-900"
                    }`}
                  />
                </div>
                <div>
                  <label className="text-[10px] text-zinc-500 font-semibold uppercase tracking-wider block mb-0.5">
                    Est. Fees
                  </label>
                  <div className="px-2 py-1.5 text-xs font-mono text-red-400">
                    {estimatedFees == null ? "—" : `£${Number(estimatedFees).toFixed(2)}`}
                  </div>
                </div>
                <div>
                  <label className="text-[10px] text-zinc-500 font-semibold uppercase tracking-wider block mb-0.5">
                    Net
                  </label>
                  <div className="px-2 py-1.5 text-xs font-mono text-teal-500">
                    {estimatedNet == null ? "—" : `£${Number(estimatedNet).toFixed(2)}`}
                  </div>
                </div>
              </div>

              {/* Warnings */}
              {belowFloor && (
                <div className="mb-2 rounded-md border border-red-200 bg-red-50 p-2 text-[11px] font-medium text-red-700">
                  Calculated target is below the {ch.label} floor (£{floorPrice!.toFixed(2)}). Update channel costs or pricing controls before publishing.
                </div>
              )}

              {ch.key === "website" && webPreflight && !webPreflight.can_publish && (
                <div className="mb-2 rounded-md border border-amber-200 bg-amber-50 p-2 text-[11px] text-amber-800">
                  <div className="font-semibold">Website publish blocked</div>
                  <div className="mt-1 space-y-0.5">
                    {webPreflight.blockers.map((blocker) => (
                      <div key={blocker}>{blocker}</div>
                    ))}
                  </div>
                  {webPreflight.actions.includes("activate_sku") && (
                    <div className="mt-2 flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={async () => {
                          try {
                            await activateSku.mutateAsync({ skuId: variant.id, skuCode: variant.sku });
                            toast.success(`${variant.sku} activated`);
                            await refreshWebsitePreflight();
                          } catch (err) {
                            toast.error(err instanceof Error ? err.message : "Failed to activate SKU");
                          }
                        }}
                        disabled={activateSku.isPending}
                        className="rounded border border-amber-300 bg-white px-2 py-1 text-[10px] font-semibold text-amber-800 disabled:opacity-50"
                      >
                        {activateSku.isPending ? "Activating..." : "Activate SKU"}
                      </button>
                      <button
                        type="button"
                        onClick={refreshWebsitePreflight}
                        className="rounded border border-zinc-300 bg-white px-2 py-1 text-[10px] font-semibold text-zinc-700"
                      >
                        Recheck
                      </button>
                    </div>
                  )}
                  {!webPreflight.actions.includes("activate_sku") && webPreflight.actions.includes("recalculate_price") && (
                    <button
                      type="button"
                      onClick={refreshWebsitePreflight}
                      className="mt-2 rounded border border-amber-300 bg-white px-2 py-1 text-[10px] font-semibold text-amber-800"
                    >
                      Recalculate price
                    </button>
                  )}
                </div>
              )}

              {ch.key === "website" && webPreflight?.warnings?.length ? (
                <div className="mb-2 rounded-md border border-zinc-200 bg-white p-2 text-[11px] text-zinc-600">
                  {webPreflight.warnings.map((warning) => warning.replace(/_/g, " ")).join("; ")}
                </div>
              ) : null}

              {pricing && (
                <div className="mb-2 grid grid-cols-1 gap-2 rounded border border-zinc-200 bg-white px-2 py-1.5 text-[10px] sm:grid-cols-3">
                  <span className="text-zinc-500">Floor <Mono color="red">£{Number(pricing.floor_price ?? 0).toFixed(2)}</Mono></span>
                  <span className="text-zinc-500">Ceiling <Mono color="amber">£{Number(pricing.ceiling_price ?? 0).toFixed(2)}</Mono></span>
                  <span className="text-zinc-500">Market <Mono color={pricing.market_consensus == null ? "amber" : "teal"}>{pricing.market_consensus == null ? "n/a" : `£${Number(pricing.market_consensus).toFixed(2)}`}</Mono></span>
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
