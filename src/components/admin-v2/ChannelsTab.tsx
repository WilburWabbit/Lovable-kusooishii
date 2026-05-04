import { useState, useMemo, useEffect, useRef } from "react";
import {
  useChannelListings,
  useChannelFees,
  usePublishListing,
  useChannelListingAction,
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

const DISABLED_CONNECTORS = new Set<Channel>(["bricklink", "brickowl"]);

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
  const channelAction = useChannelListingAction();

  const listingsByChannel = useMemo(() => {
    const map = new Map<string, ChannelListing>();
    for (const l of listings) map.set(l.channel, l);
    return map;
  }, [listings]);
  const gmcListing = listingsByChannel.get("google_shopping") ?? listingsByChannel.get("gmc");

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

  // Per-channel local state for title, description, price.
  // Tracks which fields the user has manually edited so async loads of
  // `listings`/`feesMap` don't clobber unsaved typing — but they DO populate
  // fields the user hasn't touched (the previous useState-only init left the
  // form stuck on default-generated values when listings arrived after first
  // render, causing the wrong title to be pushed to eBay).
  const dirtyRef = useRef<Record<string, { title: boolean; description: boolean; price: boolean }>>({});
  const [channelState, setChannelState] = useState<
    Record<string, { title: string; description: string; price: string }>
  >({});
  const [overrideState, setOverrideState] = useState<
    Record<string, { approved: boolean; reason: string }>
  >({});

  useEffect(() => {
    setChannelState((prev) => {
      const next: Record<string, { title: string; description: string; price: string }> = { ...prev };
      for (const ch of CHANNELS) {
        const existing = listings.find((l) => l.channel === ch.key);
        const feeInfo = feesMap?.get(ch.key);
        const basePrice = variant.salePrice ?? 0;
        const feeCalc = calculateChannelPrice(basePrice, variant.floorPrice, feeInfo);
        const dirty = dirtyRef.current[ch.key] ?? { title: false, description: false, price: false };
        const current = prev[ch.key];

        const defaultTitle = ch.key === "ebay" ? defaultEbayTitle : product.name;
        next[ch.key] = {
          title: dirty.title
            ? current?.title ?? ""
            : existing?.listingTitle ?? defaultTitle,
          description: dirty.description
            ? current?.description ?? ""
            : existing?.listingDescription ?? "",
          price: dirty.price
            ? current?.price ?? ""
            : existing?.listingPrice?.toFixed(2) ?? feeCalc.suggestedPrice.toFixed(2),
        };
      }
      return next;
    });
  }, [listings, feesMap, defaultEbayTitle, product.name, variant.salePrice, variant.floorPrice]);

  const updateField = (channel: string, field: "title" | "description" | "price", value: string) => {
    const channelDirty = dirtyRef.current[channel] ?? { title: false, description: false, price: false };
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

  const updateOverride = (channel: string, patch: Partial<{ approved: boolean; reason: string }>) => {
    setOverrideState((prev) => ({
      ...prev,
      [channel]: {
        approved: prev[channel]?.approved ?? false,
        reason: prev[channel]?.reason ?? "",
        ...patch,
      },
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
    const belowFloor = variant.floorPrice != null && price > 0 && price < variant.floorPrice;
    const override = overrideState[ch.key] ?? { approved: false, reason: "" };

    if (belowFloor && (!override.approved || override.reason.trim().length < 5)) {
      toast.error("Approve the below-floor price and enter a reason");
      return;
    }

    try {
      await publishListing.mutateAsync({
        skuCode: variant.sku,
        channel: ch.key,
        listingTitle: state.title.trim(),
        listingDescription: state.description.trim() || undefined,
        listingPrice: price,
        estimatedFees: feeCalc.estimatedFees,
        estimatedNet: feeCalc.estimatedNet,
        allowBelowFloor: belowFloor && override.approved,
        overrideReasonCode: belowFloor ? "below_floor_staff_approval" : undefined,
        overrideReasonNote: belowFloor ? override.reason.trim() : undefined,
      });
      toast.success(`Queued ${variant.sku} for ${ch.label}`);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Publish failed";
      toast.error(message);
    }
  };

  const handleAvailabilityAction = async (
    ch: { key: Channel; label: string },
    listing: ChannelListing | undefined,
    action: "set-channel-out-of-stock" | "clear-channel-out-of-stock" | "delist-channel-listing",
  ) => {
    if (!listing) return;

    const copy = {
      "set-channel-out-of-stock": `Set ${variant.sku} as out of stock on ${ch.label}?`,
      "clear-channel-out-of-stock": `Clear the manual out-of-stock hold for ${variant.sku} on ${ch.label}?`,
      "delist-channel-listing": `Delist ${variant.sku} from ${ch.label}?`,
    }[action];

    if (!window.confirm(copy)) return;

    try {
      await channelAction.mutateAsync({
        skuCode: variant.sku,
        listingId: listing.id,
        action,
      });

      const message = {
        "set-channel-out-of-stock": `${ch.label} out-of-stock sync queued`,
        "clear-channel-out-of-stock": `${ch.label} stock sync queued`,
        "delist-channel-listing": `${ch.label} delist queued`,
      }[action];
      toast.success(message);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Channel action failed";
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
          const override = overrideState[ch.key] ?? { approved: false, reason: "" };
          const titleEmpty = !state.title?.trim();
          const overrideReady = !belowFloor || (override.approved && override.reason.trim().length >= 5);
          const canPublish = !titleEmpty && price > 0 && overrideReady;
          const manualOutOfStock = listing?.availabilityOverride === "manual_out_of_stock";
          const connectorDisabled = DISABLED_CONNECTORS.has(ch.key);
          const listingEnded = status === "ended";
          const delistQueued = String(listing?.offerStatus ?? "").toLowerCase() === "end_queued";
          const actionDisabled = !listing || connectorDisabled || listingEnded || delistQueued || channelAction.isPending;
          const connectorMessage = connectorDisabled ? "Connector not available yet" : undefined;

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
                  {manualOutOfStock && (
                    <Badge label="Manual OOS" color="#F59E0B" small />
                  )}
                </div>
              </div>

              <div className="mb-2 flex flex-wrap items-center gap-2 text-[10px] text-zinc-600">
                <span>
                  Qty: <Mono className="text-[10px]">{listing?.listedQuantity ?? "—"}</Mono>
                </span>
                {listing?.offerStatus && (
                  <span>
                    Offer: <Mono className="text-[10px]">{listing.offerStatus}</Mono>
                  </span>
                )}
                {listing?.externalId && (
                  <span>
                    External:{" "}
                    {listing.externalUrl ? (
                      <a
                        href={listing.externalUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="font-mono text-[10px] text-teal-600 underline underline-offset-2"
                      >
                        {listing.externalId}
                      </a>
                    ) : (
                      <Mono className="text-[10px]">{listing.externalId}</Mono>
                    )}
                  </span>
                )}
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
                <div className="mb-2 space-y-2 rounded-md border border-red-200 bg-red-50 p-2">
                  <label className="flex items-center gap-2 text-[11px] font-medium text-red-700">
                    <input
                      type="checkbox"
                      checked={override.approved}
                      onChange={(e) => updateOverride(ch.key, { approved: e.target.checked })}
                      className="h-3.5 w-3.5"
                    />
                    Approve below floor price (£{variant.floorPrice!.toFixed(2)})
                  </label>
                  <input
                    value={override.reason}
                    onChange={(e) => updateOverride(ch.key, { reason: e.target.value })}
                    placeholder="Reason for pricing override"
                    className="w-full rounded border border-red-200 bg-white px-2 py-1.5 text-[11px] text-zinc-900"
                  />
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
                disabled={!canPublish || publishListing.isPending || channelAction.isPending}
                className="w-full py-1.5 rounded text-[11px] font-semibold cursor-pointer transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                style={{
                  background: canPublish ? "#22C55E" : "#E4E4E7",
                  color: canPublish ? "#18181B" : "#71717A",
                  border: canPublish ? "none" : "1px solid #D4D4D8",
                }}
              >
                {publishListing.isPending ? "Publishing…" : status === "live" ? "Update Listing" : "Publish"}
              </button>

              <div className="mt-2 grid grid-cols-2 gap-2">
                <button
                  onClick={() =>
                    handleAvailabilityAction(
                      ch,
                      listing,
                      manualOutOfStock ? "clear-channel-out-of-stock" : "set-channel-out-of-stock",
                    )
                  }
                  disabled={actionDisabled}
                  title={connectorMessage}
                  className="rounded border border-zinc-300 bg-white px-2 py-1.5 text-[11px] font-semibold text-zinc-700 transition-colors hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {manualOutOfStock ? "Clear OOS" : "Set OOS"}
                </button>
                <button
                  onClick={() => handleAvailabilityAction(ch, listing, "delist-channel-listing")}
                  disabled={actionDisabled}
                  title={connectorMessage}
                  className="rounded border border-red-200 bg-white px-2 py-1.5 text-[11px] font-semibold text-red-600 transition-colors hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Delist
                </button>
              </div>
              {connectorDisabled && (
                <div className="mt-1 text-[10px] text-zinc-500">Connector not available yet</div>
              )}

              {ch.key === "website" && (
                <div className="mt-2 rounded border border-zinc-200 bg-white px-2 py-1.5">
                  <div className="flex flex-wrap items-center gap-2 text-[10px] text-zinc-600">
                    <span className="font-semibold text-zinc-800">GMC</span>
                    {gmcListing ? (
                      <>
                        <span>Follows Website availability</span>
                        {gmcListing.availabilityOverride === "manual_out_of_stock" && (
                          <Badge label="Manual OOS" color="#F59E0B" small />
                        )}
                        <span>
                          Qty: <Mono className="text-[10px]">{gmcListing.listedQuantity ?? "—"}</Mono>
                        </span>
                        {gmcListing.offerStatus && (
                          <span>
                            Offer: <Mono className="text-[10px]">{gmcListing.offerStatus}</Mono>
                          </span>
                        )}
                      </>
                    ) : (
                      <span>No GMC listing queued</span>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </SurfaceCard>
  );
}
