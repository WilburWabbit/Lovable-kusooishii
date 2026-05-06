import { useState, useMemo, useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  channelListingKeys,
  useChannelListings,
  useChannelFees,
  usePublishListing,
  useChannelListingAction,
  useVariantChannelPricing,
  useWebsiteListingPreflight,
  useActivateSku,
} from "@/hooks/admin/use-channel-listings";
import { CHANNEL_LISTING_STATUSES } from "@/lib/constants/unit-statuses";
import type { ProductVariant, Product, Channel, ChannelListing } from "@/lib/types/admin";
import { SurfaceCard, Mono, Badge, GradeBadge, SectionHead } from "./ui-primitives";
import { TraceMetadata } from "./TraceMetadata";
import { toast } from "sonner";
import { generateEbayTitle } from "@/lib/utils/generate-ebay-title";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ShieldAlert } from "lucide-react";

interface ChannelsTabProps {
  variants: ProductVariant[];
  product: Product;
}

const CHANNELS: { key: Channel; label: string; titleLimit: number }[] = [
  { key: "ebay", label: "eBay", titleLimit: 80 },
  { key: "website", label: "Website", titleLimit: 200 },
];

function normalizedChannel(channel: Channel | string | null | undefined): Channel {
  if (channel === "web") return "website";
  return (channel ?? "website") as Channel;
}

type ChannelFormState = { title: string; description: string; price: string };
type ChannelDirtyState = { title: boolean; description: boolean; price: boolean };
type OverrideRequest = {
  channel: { key: Channel; label: string };
  price: number;
  floorPrice: number;
};

const cleanDirtyState: ChannelDirtyState = { title: false, description: false, price: false };

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
  const publishListing = usePublishListing();
  const channelAction = useChannelListingAction();
  const activateSku = useActivateSku();
  const queryClient = useQueryClient();
  const [overrideRequest, setOverrideRequest] = useState<OverrideRequest | null>(null);
  const [overrideReasonCode, setOverrideReasonCode] = useState("operator_override");
  const [overrideReasonNote, setOverrideReasonNote] = useState("");

  const listingsByChannel = useMemo(() => {
    const map = new Map<string, ChannelListing>();
    for (const l of listings) map.set(normalizedChannel(l.channel), l);
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

  // Per-channel local state for title and description.
  // Tracks which fields the user has manually edited so async loads of
  // `listings`/`feesMap` don't clobber unsaved typing — but they DO populate
  // fields the user hasn't touched (the previous useState-only init left the
  // form stuck on default-generated values when listings arrived after first
  // render, causing the wrong title to be pushed to eBay).
  const dirtyRef = useRef<Record<string, ChannelDirtyState>>({});
  const [channelState, setChannelState] = useState<Record<string, ChannelFormState>>({});
  const websiteInputPrice = Number(channelState.website?.price ?? "");
  const websitePreflightPrice = Number.isFinite(websiteInputPrice) && websiteInputPrice > 0
    ? websiteInputPrice
    : null;
  const { data: webPreflight, isLoading: webPreflightLoading } = useWebsiteListingPreflight(
    variant.id,
    websitePreflightPrice,
  );

  useEffect(() => {
    setChannelState((prev) => {
      const next: Record<string, ChannelFormState> = { ...prev };
      for (const ch of CHANNELS) {
        const existing = listings.find((l) => normalizedChannel(l.channel) === ch.key);
        const pricing = pricingByChannel?.get(ch.key);
        const quoteBelongsToVariant = !pricing || pricing.sku_id === variant.id;
        const quoteIsUsable = quoteBelongsToVariant && !pricing?.quote_error;
        const dirty = dirtyRef.current[ch.key] ?? cleanDirtyState;
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
            : quoteIsUsable
              ? pricing?.target_price?.toFixed(2) ?? existing?.listingPrice?.toFixed(2) ?? ""
              : existing?.listingPrice?.toFixed(2) ?? "",
        };
      }
      return next;
    });
  }, [listings, pricingByChannel, defaultEbayTitle, product.name, variant.id]);

  const updateField = (channel: string, field: keyof ChannelDirtyState, value: string) => {
    const channelDirty = dirtyRef.current[channel] ?? cleanDirtyState;
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

  const isOnlyBelowFloorWebsiteBlock = (blockers: string[]) =>
    blockers.length > 0 && blockers.every((blocker) => blocker.includes("is below floor"));

  const handlePublish = async (
    ch: { key: Channel; label: string },
    override?: { reasonCode: string; reasonNote?: string | null },
  ) => {
    const state = channelState[ch.key];
    const listing = listingsByChannel.get(ch.key);
    const pricing = pricingByChannel?.get(ch.key);
    const allowBelowFloor = Boolean(override);
    if (pricing && pricing.sku_id !== variant.id) {
      toast.error(`${ch.label} pricing quote does not match ${variant.sku}`);
      return;
    }
    if (ch.key === "website" && webPreflight && !webPreflight.can_publish) {
      const canOverrideBlock = allowBelowFloor && isOnlyBelowFloorWebsiteBlock(webPreflight.blockers);
      if (!canOverrideBlock) {
        toast.error(webPreflight.blockers[0] ?? "Website listing is blocked");
        return;
      }
    }
    if (!state?.title?.trim()) {
      toast.error(`${ch.label} listing title is required`);
      return;
    }

    const price = Number(state?.price ?? "");
    if (isNaN(price) || price <= 0) {
      toast.error("Enter a valid listing price");
      return;
    }

    const floorPrice = pricing?.floor_price ?? listing?.priceFloor ?? null;
    if (floorPrice != null && price < floorPrice) {
      if (!allowBelowFloor) {
        setOverrideRequest({ channel: ch, price, floorPrice });
        return;
      }
      if (!override?.reasonCode?.trim()) {
        toast.error("Override reason is required");
        return;
      }
    }

    if (allowBelowFloor && !override?.reasonCode?.trim()) {
      toast.error("Override reason is required");
      return;
    }

    const priceDirty = dirtyRef.current[ch.key]?.price ?? false;
    if (pricing?.quote_error && (!priceDirty || floorPrice == null || (price < floorPrice && !allowBelowFloor))) {
      toast.error(`${ch.label} pricing quote must be fixed before publishing`);
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
        allowBelowFloor,
        overrideReasonCode: override?.reasonCode,
        overrideReasonNote: override?.reasonNote ?? undefined,
      });
      toast.success(`Queued ${variant.sku} for ${ch.label}`);
      setOverrideRequest(null);
      setOverrideReasonNote("");
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

  const refreshWebsitePreflight = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: channelListingKeys.pricingByVariant(variant.id) }),
      queryClient.invalidateQueries({ queryKey: channelListingKeys.websitePreflight(variant.id) }),
    ]);
  };

  return (
    <>
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
          const dirty = dirtyRef.current[ch.key] ?? cleanDirtyState;
          const feeInfo = feesMap?.get(ch.key) ?? (ch.key === "website" ? feesMap?.get("web") : undefined);
          const quote = pricingByChannel?.get(ch.key);
          const pricing = quote?.sku_id === variant.id ? quote : undefined;
          const pricingError = pricing?.quote_error ?? null;
          const price = Number(state.price) || 0;
          const floorPrice = pricing?.floor_price ?? listing?.priceFloor ?? null;
          const estimatedFees = pricing?.estimated_fees ?? listing?.estimatedFees ?? null;
          const estimatedNet = pricing?.estimated_net ?? listing?.estimatedNet ?? null;
          const belowFloor = floorPrice != null && price > 0 && price < floorPrice;
          const titleEmpty = !state.title?.trim();
          const websiteBlocked = ch.key === "website" && webPreflight ? !webPreflight.can_publish : false;
          const websiteHardBlocked = ch.key === "website" && webPreflight
            ? !webPreflight.can_publish && !isOnlyBelowFloorWebsiteBlock(webPreflight.blockers)
            : false;
          const preflightChecking = ch.key === "website" && webPreflightLoading;
          const manualAboveKnownFloor = dirty.price && price > 0 && floorPrice != null && price >= floorPrice;
          const quoteReady = Boolean(pricing && !pricingError);
          const canPublish = !pricingLoading
            && !webPreflightLoading
            && !titleEmpty
            && price > 0
            && !websiteHardBlocked
            && (quoteReady || manualAboveKnownFloor || belowFloor);
          const stockCount = ch.key === "website" ? webPreflight?.saleable_stock_count : pricing?.stock_unit_count;
          const confidence = pricing?.confidence_score == null ? null : Math.round(Number(pricing.confidence_score) * 100);
          const manualOutOfStock = listing?.availabilityOverride === "manual_out_of_stock";
          const listingEnded = status === "ended";
          const delistQueued = String(listing?.offerStatus ?? "").toLowerCase() === "end_queued";
          const actionDisabled = !listing || listingEnded || delistQueued || channelAction.isPending;

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
                  {dirty.price && <Badge label="Manual price" color="#71717A" small />}
                  {liveAndBelowFloor && (
                    <Badge label="Below floor" color="#EF4444" small />
                  )}
                  {manualOutOfStock && (
                    <Badge label="Manual OOS" color="#F59E0B" small />
                  )}
                </div>
                <div className="flex items-center gap-2 text-[10px] text-zinc-500">
                  <span>Stock <Mono color={stockCount ? "teal" : "amber"}>{stockCount ?? "—"}</Mono></span>
                  <span>Confidence <Mono color={confidence != null && confidence >= 70 ? "teal" : "amber"}>{confidence == null ? "—" : `${confidence}%`}</Mono></span>
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
              {listing && (
                <TraceMetadata
                  className="mb-2"
                  items={[
                    { label: "Listing ID", value: listing.id },
                    { label: "SKU ID", value: variant.id },
                    { label: "External", value: listing.externalId },
                  ]}
                />
              )}

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
                  Price is below the {ch.label} floor (£{floorPrice!.toFixed(2)}). Publishing will require an override reason.
                </div>
              )}

              {pricingError && (
                <div className="mb-2 rounded-md border border-red-200 bg-red-50 p-2 text-[11px] font-medium text-red-700">
                  <div>Price quote failed for {ch.label}.</div>
                  <div className="mt-0.5 font-normal">{pricingError}</div>
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

              {pricing && !pricingError && (
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
                  className="rounded border border-zinc-300 bg-white px-2 py-1.5 text-[11px] font-semibold text-zinc-700 transition-colors hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {manualOutOfStock ? "Clear OOS" : "Set OOS"}
                </button>
                <button
                  onClick={() => handleAvailabilityAction(ch, listing, "delist-channel-listing")}
                  disabled={actionDisabled}
                  className="rounded border border-red-200 bg-white px-2 py-1.5 text-[11px] font-semibold text-red-600 transition-colors hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Delist
                </button>
              </div>

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
    <Dialog open={!!overrideRequest} onOpenChange={(open) => !open && setOverrideRequest(null)}>
      <DialogContent className="bg-white text-zinc-900 sm:max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <ShieldAlert className="h-4 w-4 text-red-500" />
            <DialogTitle>Below-floor price override</DialogTitle>
          </div>
          <DialogDescription>
            {overrideRequest
              ? `${variant.sku} on ${overrideRequest.channel.label}: £${overrideRequest.price.toFixed(2)} is below the £${overrideRequest.floorPrice.toFixed(2)} floor.`
              : "This price is below the current floor."}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3">
          <div>
            <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
              Reason code
            </label>
            <select
              value={overrideReasonCode}
              onChange={(event) => setOverrideReasonCode(event.target.value)}
              className="w-full rounded border border-zinc-200 bg-white px-2 py-1.5 text-xs"
            >
              <option value="operator_override">Operator override</option>
              <option value="clearance">Clearance</option>
              <option value="defect_disclosure">Defect disclosure</option>
              <option value="market_test">Market test</option>
              <option value="customer_commitment">Customer commitment</option>
            </select>
          </div>
          <div>
            <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
              Note
            </label>
            <textarea
              value={overrideReasonNote}
              onChange={(event) => setOverrideReasonNote(event.target.value)}
              rows={3}
              className="w-full resize-y rounded border border-zinc-200 bg-white px-2 py-1.5 text-xs"
              placeholder="Add the operator rationale for this listing price"
            />
          </div>
        </div>

        <DialogFooter>
          <button
            type="button"
            onClick={() => setOverrideRequest(null)}
            className="rounded border border-zinc-300 bg-white px-3 py-1.5 text-xs font-semibold text-zinc-700 hover:bg-zinc-50"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!overrideReasonCode.trim() || publishListing.isPending}
            onClick={() => {
              if (!overrideRequest) return;
              handlePublish(overrideRequest.channel, {
                reasonCode: overrideReasonCode,
                reasonNote: overrideReasonNote.trim() || null,
              });
            }}
            className="rounded bg-red-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {publishListing.isPending ? "Queueing..." : "Override and publish"}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    </>
  );
}
