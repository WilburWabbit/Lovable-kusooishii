import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Calculator, Loader2, TrendingUp } from "lucide-react";
import { invokeWithAuth } from "@/lib/invokeWithAuth";
import { toast } from "sonner";
import { CHANNELS, CHANNEL_LABELS, GRADE_LABELS, fmt } from "./types";
import type { ProductDetail, BrickEconomyValuation } from "./types";

interface ProductPricingTabProps {
  product: ProductDetail;
  beValuation: BrickEconomyValuation | null | undefined;
  onInvalidate: () => void;
}

export function ProductPricingTab({ product, beValuation, onInvalidate }: ProductPricingTabProps) {
  const [pricingResults, setPricingResults] = useState<Record<string, any>>({});
  const [pricingLoading, setPricingLoading] = useState<string | null>(null);
  const [calculatingAll, setCalculatingAll] = useState(false);

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

      const { listing_id } = await invokeWithAuth<{ listing_id: string; created: boolean }>(
        "admin-data",
        { action: "ensure-channel-listing", sku_id: skuId, channel },
      );

      await invokeWithAuth("admin-data", {
        action: "update-listing-prices",
        listing_id,
        price_floor: result.floor_price,
        price_target: result.target_price,
        price_ceiling: result.ceiling_price,
        confidence_score: result.confidence_score,
        auto_price: true,
      });

      onInvalidate();
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

      {/* Per-SKU pricing */}
      {product.skus.map((sku) => {
        const listedChannels = CHANNELS.filter((ch) =>
          sku.channel_listings.some((cl) => cl.channel === ch),
        );
        const unlistedChannels = CHANNELS.filter(
          (ch) => !sku.channel_listings.some((cl) => cl.channel === ch),
        );

        return (
          <Card key={sku.id}>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <div className="flex items-center gap-2">
                <CardTitle className="text-sm font-medium font-mono">{sku.sku_code}</CardTitle>
                <Badge variant="outline" className="text-[10px]">
                  {GRADE_LABELS[sku.condition_grade] ?? sku.condition_grade}
                </Badge>
              </div>
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs"
                disabled={calculatingAll}
                onClick={async () => {
                  for (const ch of CHANNELS) {
                    await handleCalculatePricing(sku.id, ch);
                  }
                }}
              >
                <Calculator className="h-3 w-3 mr-1" />
                Price All Channels
              </Button>
            </CardHeader>
            <CardContent className="space-y-3">
              {/* Listed channels */}
              {listedChannels.map((ch) => {
                const cl = sku.channel_listings.find((l) => l.channel === ch)!;
                const key = `${sku.id}:${ch}`;
                const pricing = pricingResults[key];
                const isLoading = pricingLoading === key;
                const listedPrice = cl.listed_price;
                const belowFloor =
                  pricing && listedPrice != null && listedPrice < pricing.floor_price;

                return (
                  <div
                    key={ch}
                    className={`border rounded-lg p-3 space-y-2 ${
                      belowFloor ? "border-destructive bg-destructive/5" : "border-border"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Badge variant="outline" className="text-[10px]">
                          {CHANNEL_LABELS[ch]}
                        </Badge>
                        <Badge
                          variant="outline"
                          className="text-[10px] bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400"
                        >
                          {cl.offer_status ?? "—"}
                        </Badge>
                        <span className="text-xs text-muted-foreground">
                          Listed: {fmt(listedPrice)}
                        </span>
                        {cl.price_floor != null && (
                          <span className="text-xs text-muted-foreground">
                            Floor: {fmt(cl.price_floor)}
                          </span>
                        )}
                        {cl.price_target != null && (
                          <span className="text-xs text-muted-foreground">
                            Target: {fmt(cl.price_target)}
                          </span>
                        )}
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs"
                        disabled={isLoading}
                        onClick={() => handleCalculatePricing(sku.id, ch)}
                      >
                        {isLoading ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <Calculator className="h-3 w-3 mr-1" />
                        )}
                        Price
                      </Button>
                    </div>

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
                  </div>
                );
              })}

              {/* Unlisted channels — compact row */}
              {unlistedChannels.length > 0 && (
                <div className="flex items-center gap-2 pt-1">
                  <span className="text-[10px] text-muted-foreground">Not listed:</span>
                  {unlistedChannels.map((ch) => {
                    const key = `${sku.id}:${ch}`;
                    const isLoading = pricingLoading === key;
                    return (
                      <Button
                        key={ch}
                        size="sm"
                        variant="ghost"
                        className="h-6 text-[10px] px-2 text-muted-foreground"
                        disabled={isLoading}
                        onClick={() => handleCalculatePricing(sku.id, ch)}
                      >
                        {isLoading ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <>
                            <Calculator className="h-3 w-3 mr-0.5" />
                            {CHANNEL_LABELS[ch]}
                          </>
                        )}
                      </Button>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        );
      })}

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
