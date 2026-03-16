import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Calculator, Loader2, TrendingUp, Plus, X, Power,
} from "lucide-react";
import { invokeWithAuth } from "@/lib/invokeWithAuth";
import { toast } from "sonner";
import { ChannelOverrideForm } from "./ChannelOverrideForm";
import { CHANNELS, CHANNEL_LABELS, GRADE_LABELS, fmt } from "./types";
import type { ProductDetail, ProductSku, BrickEconomyValuation, ChannelListing } from "./types";

interface ProductChannelsTabProps {
  product: ProductDetail;
  beValuation: BrickEconomyValuation | null | undefined;
  onInvalidate: () => void;
}

export function ProductChannelsTab({ product, beValuation, onInvalidate }: ProductChannelsTabProps) {
  const [listingAction, setListingAction] = useState<string | null>(null);
  const [pricingResults, setPricingResults] = useState<Record<string, any>>({});
  const [pricingLoading, setPricingLoading] = useState<string | null>(null);
  const [calculatingAll, setCalculatingAll] = useState(false);

  /* ── Listing actions ── */
  const handleListingAction = async (ch: string, skuId: string, action: "create" | "remove") => {
    const actionKey = `${ch}:${skuId}`;
    setListingAction(actionKey);
    try {
      if (action === "create") {
        if (ch === "ebay") {
          await invokeWithAuth("ebay-sync", { action: "create_listing", sku_id: skuId });
          toast.success("eBay listing created");
        } else {
          const pricingKey = `${skuId}:${ch}`;
          const pricing = pricingResults[pricingKey];
          const listPrice = pricing?.target_price ?? pricing?.ceiling_price ?? undefined;
          await invokeWithAuth("admin-data", {
            action: "create-web-listing",
            sku_id: skuId,
            listed_price: listPrice,
          });
          toast.success("Web listing created");
        }
      } else {
        if (ch === "ebay") {
          await invokeWithAuth("ebay-sync", { action: "remove_listing", sku_id: skuId });
          toast.success("eBay listing removed");
        } else {
          await invokeWithAuth("admin-data", { action: "remove-web-listing", sku_id: skuId });
          toast.success("Web listing removed");
        }
      }
      onInvalidate();
    } catch (err: any) {
      toast.error(err.message ?? "Listing action failed");
    } finally {
      setListingAction(null);
    }
  };

  /* ── Pricing ── */
  const handleCalculatePricing = async (skuId: string, channel: string) => {
    const key = `${skuId}:${channel}`;
    setPricingLoading(key);
    try {
      const result = await invokeWithAuth<any>("admin-data", {
        action: "calculate-pricing",
        sku_id: skuId,
        channel,
      });
      setPricingResults((prev) => ({ ...prev, [key]: result }));

      // Only update prices on an existing listing — don't create one
      const listing = product.skus
        .find((s) => s.id === skuId)
        ?.channel_listings.find((cl) => cl.channel === channel);

      if (listing) {
        await invokeWithAuth("admin-data", {
          action: "update-listing-prices",
          listing_id: listing.id,
          price_floor: result.floor_price,
          price_target: result.target_price,
          price_ceiling: result.ceiling_price,
          confidence_score: result.confidence_score,
          auto_price: true,
        });
        onInvalidate();
      }

      toast.success("Pricing calculated");
    } catch (err: any) {
      toast.error(err.message ?? "Pricing failed");
    } finally {
      setPricingLoading(null);
    }
  };

  const handleCalculateAll = async () => {
    setCalculatingAll(true);
    for (const sku of product.skus) {
      for (const ch of CHANNELS) {
        await handleCalculatePricing(sku.id, ch);
      }
    }
    setCalculatingAll(false);
  };

  if (product.skus.length === 0) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center h-32 text-sm text-muted-foreground">
          No SKUs found for this product.
        </CardContent>
      </Card>
    );
  }

  /* ── Build channel-centric data ── */
  const channelData = CHANNELS.map((ch) => {
    const skusWithListings = product.skus.map((sku) => {
      const listing = sku.channel_listings.find((cl) => cl.channel === ch) ?? null;
      return { sku, listing };
    });

    const isActionable = ch === "web" || ch === "ebay";
    const hasAnyListing = skusWithListings.some(({ listing }) => listing !== null);

    return { channel: ch, label: CHANNEL_LABELS[ch], skusWithListings, isActionable, hasAnyListing };
  });

  // Only show non-actionable channels if they have listings
  const visibleChannels = channelData.filter((cd) => cd.isActionable || cd.hasAnyListing);

  return (
    <div className="space-y-4">
      {/* BrickEconomy market data */}
      {beValuation && (
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-2 mb-3">
              <TrendingUp className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-xs font-medium text-muted-foreground">BrickEconomy Market Data</span>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div>
                <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Current Value</p>
                <p className="text-sm font-bold font-mono">{fmt(beValuation.current_value)}</p>
              </div>
              <div>
                <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Growth</p>
                <p
                  className={`text-sm font-bold font-mono ${
                    beValuation.growth != null && beValuation.growth > 0
                      ? "text-emerald-600 dark:text-emerald-400"
                      : beValuation.growth != null && beValuation.growth < 0
                        ? "text-destructive"
                        : ""
                  }`}
                >
                  {beValuation.growth != null
                    ? `${beValuation.growth > 0 ? "+" : ""}${beValuation.growth.toFixed(1)}%`
                    : "—"}
                </p>
              </div>
              <div>
                <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Condition</p>
                <p className="text-sm font-mono">{beValuation.condition ?? "—"}</p>
              </div>
              <div>
                <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Synced</p>
                <p className="text-xs text-muted-foreground">
                  {beValuation.synced_at ? new Date(beValuation.synced_at).toLocaleDateString() : "—"}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Per-channel cards */}
      {visibleChannels.map(({ channel, label, skusWithListings, isActionable }) => (
        <Card key={channel}>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <div className="flex items-center gap-2">
              <CardTitle className="text-sm font-medium">{label}</CardTitle>
              {/* Aggregate status: count of listed SKUs */}
              {(() => {
                const listedCount = skusWithListings.filter(({ listing }) => listing !== null).length;
                return listedCount > 0 ? (
                  <Badge
                    variant="outline"
                    className="text-[10px] bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400"
                  >
                    {listedCount} listed
                  </Badge>
                ) : (
                  <Badge variant="outline" className="text-[10px] text-muted-foreground">
                    Not listed
                  </Badge>
                );
              })()}
            </div>
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs"
              disabled={calculatingAll}
              onClick={async () => {
                for (const { sku } of skusWithListings) {
                  await handleCalculatePricing(sku.id, channel);
                }
              }}
            >
              <Calculator className="h-3 w-3 mr-1" />
              Price All SKUs
            </Button>
          </CardHeader>
          <CardContent className="space-y-3">
            {skusWithListings.map(({ sku, listing }) => {
              const pricingKey = `${sku.id}:${channel}`;
              const pricing = pricingResults[pricingKey];
              const isLoadingPricing = pricingLoading === pricingKey;
              const actionKey = `${channel}:${sku.id}`;
              const isActing = listingAction === actionKey;
              const listedPrice = listing?.listed_price ?? null;
              const belowFloor = pricing && listedPrice != null && listedPrice < pricing.floor_price;

              return (
                <div
                  key={sku.id}
                  className={`border rounded-lg p-3 space-y-3 ${
                    belowFloor ? "border-destructive bg-destructive/5" : "border-border"
                  }`}
                >
                  {/* SKU header row */}
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono text-xs font-medium">{sku.sku_code}</span>
                      <Badge variant="outline" className="text-[10px]">
                        {GRADE_LABELS[sku.condition_grade] ?? sku.condition_grade}
                      </Badge>
                      <span className="text-xs text-muted-foreground">Stock: {sku.stock_available}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      {/* Status badge */}
                      {listing ? (
                        <Badge
                          variant="outline"
                          className="text-[10px] bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400"
                        >
                          {listing.offer_status ?? "LISTED"}
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="text-[10px] text-muted-foreground">
                          Unlisted
                        </Badge>
                      )}
                      {/* List / Unlist toggle */}
                      {isActionable && (
                        listing ? (
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-6 text-[10px] px-2 text-destructive hover:text-destructive"
                            disabled={isActing}
                            onClick={() => handleListingAction(channel, sku.id, "remove")}
                          >
                            {isActing ? (
                              <Loader2 className="h-3 w-3 animate-spin" />
                            ) : (
                              <>
                                <Power className="h-3 w-3 mr-0.5" />
                                Unlist
                              </>
                            )}
                          </Button>
                        ) : (
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-6 text-[10px] px-2"
                            disabled={isActing}
                            onClick={() => handleListingAction(channel, sku.id, "create")}
                          >
                            {isActing ? (
                              <Loader2 className="h-3 w-3 animate-spin" />
                            ) : (
                              <>
                                <Plus className="h-3 w-3 mr-0.5" />
                                List
                              </>
                            )}
                          </Button>
                        )
                      )}
                    </div>
                  </div>

                  {/* Pricing row */}
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <div className="flex items-center gap-3 flex-wrap text-xs text-muted-foreground">
                      {listing && (
                        <>
                          <span>Listed: {fmt(listedPrice)}</span>
                          {listing.price_floor != null && <span>Floor: {fmt(listing.price_floor)}</span>}
                          {listing.price_target != null && <span>Target: {fmt(listing.price_target)}</span>}
                        </>
                      )}
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs"
                      disabled={isLoadingPricing}
                      onClick={() => handleCalculatePricing(sku.id, channel)}
                    >
                      {isLoadingPricing ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <Calculator className="h-3 w-3 mr-1" />
                      )}
                      Price
                    </Button>
                  </div>

                  {/* Pricing results grid */}
                  {pricing && (
                    <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                      <div>
                        <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Floor</p>
                        <p className="text-sm font-bold font-mono">{fmt(pricing.floor_price)}</p>
                      </div>
                      <div>
                        <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Target</p>
                        <p className="text-sm font-bold font-mono">{fmt(pricing.target_price)}</p>
                      </div>
                      <div>
                        <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Ceiling</p>
                        <p className="text-sm font-bold font-mono">{fmt(pricing.ceiling_price)}</p>
                      </div>
                      <div>
                        <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Cost Base</p>
                        <p className="text-sm font-bold font-mono">{fmt(pricing.cost_base)}</p>
                      </div>
                      <div>
                        <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Confidence</p>
                        <Badge
                          variant="outline"
                          className={`text-[10px] ${
                            pricing.confidence_score >= 0.7
                              ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400"
                              : pricing.confidence_score >= 0.4
                                ? "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400"
                                : "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400"
                          }`}
                        >
                          {pricing.confidence_score >= 0.7
                            ? "High"
                            : pricing.confidence_score >= 0.4
                              ? "Medium"
                              : "Low"}
                          {` (${Math.round(pricing.confidence_score * 100)}%)`}
                        </Badge>
                      </div>
                    </div>
                  )}

                  {belowFloor && (
                    <p className="text-xs text-destructive font-medium">
                      Listed price ({fmt(listedPrice)}) is below floor ({fmt(pricing.floor_price)})
                    </p>
                  )}

                  {/* Channel override form */}
                  {listing && (
                    <ChannelOverrideForm
                      listing={listing}
                      productName={product.name}
                      onInvalidate={onInvalidate}
                    />
                  )}
                </div>
              );
            })}
          </CardContent>
        </Card>
      ))}

      {/* Calculate All button */}
      <div className="flex justify-end">
        <Button variant="outline" disabled={calculatingAll} onClick={handleCalculateAll}>
          {calculatingAll ? (
            <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
          ) : (
            <Calculator className="h-3.5 w-3.5 mr-1.5" />
          )}
          {calculatingAll ? "Calculating…" : "Calculate All Pricing"}
        </Button>
      </div>
    </div>
  );
}
