import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table, TableBody, TableCell, TableHeader, TableRow, TableHead,
} from "@/components/ui/table";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Plus, X, Loader2, ChevronDown } from "lucide-react";
import { invokeWithAuth } from "@/lib/invokeWithAuth";
import { toast } from "sonner";
import { ChannelOverrideForm } from "./ChannelOverrideForm";
import { CHANNELS, CHANNEL_LABELS, GRADE_LABELS, fmt } from "./types";
import type { ProductDetail, ProductSku } from "./types";

interface ProductListingsTabProps {
  product: ProductDetail;
  onInvalidate: () => void;
}

export function ProductListingsTab({ product, onInvalidate }: ProductListingsTabProps) {
  const [listingAction, setListingAction] = useState<string | null>(null);
  const [expandedSku, setExpandedSku] = useState<string | null>(null);

  const handleListingAction = async (ch: string, skuId: string, action: "create" | "remove") => {
    const actionKey = `${ch}:${skuId}`;
    setListingAction(actionKey);
    try {
      if (action === "create") {
        if (ch === "ebay") {
          await invokeWithAuth("ebay-sync", { action: "create_listing", sku_id: skuId });
          toast.success("eBay listing created");
        } else {
          await invokeWithAuth("admin-data", { action: "create-web-listing", sku_id: skuId });
          toast.success("Web listing created");
        }
      } else {
        await invokeWithAuth("admin-data", { action: "remove-web-listing", sku_id: skuId });
        toast.success("Web listing removed");
      }
      onInvalidate();
    } catch (err: any) {
      toast.error(err.message ?? "Listing action failed");
    } finally {
      setListingAction(null);
    }
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

  const renderChannelBadge = (sku: ProductSku, ch: string) => {
    const cl = sku.channel_listings.find((l) => l.channel === ch);
    const actionKey = `${ch}:${sku.id}`;
    const isActing = listingAction === actionKey;

    if (cl) {
      return (
        <div className="flex items-center gap-1">
          <Badge
            variant="outline"
            className="text-[10px] px-1.5 py-0 bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400"
          >
            {cl.offer_status ?? "—"}
          </Badge>
          {ch === "web" && (
            <Button
              variant="ghost"
              size="icon"
              className="h-5 w-5"
              disabled={isActing}
              onClick={(e) => { e.stopPropagation(); handleListingAction(ch, sku.id, "remove"); }}
            >
              {isActing ? <Loader2 className="h-3 w-3 animate-spin" /> : <X className="h-3 w-3" />}
            </Button>
          )}
        </div>
      );
    }

    if (ch === "ebay" || ch === "web") {
      return (
        <Button
          variant="outline"
          size="sm"
          className="h-6 text-[10px] px-2"
          disabled={isActing}
          onClick={(e) => { e.stopPropagation(); handleListingAction(ch, sku.id, "create"); }}
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
      );
    }

    return <span className="text-muted-foreground/40">—</span>;
  };

  const getSkuListings = (sku: ProductSku) =>
    sku.channel_listings.filter((cl) => cl.listing_title != null || cl.listing_description != null || cl.channel === "ebay");

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-medium">SKUs & Channel Listings</CardTitle>
      </CardHeader>
      <CardContent className="p-0 md:p-0">
        {/* Mobile card view */}
        <div className="md:hidden space-y-2 p-3">
          {product.skus.map((s) => {
            const listings = s.channel_listings;
            const isExpanded = expandedSku === s.id;
            return (
              <Collapsible key={s.id} open={isExpanded} onOpenChange={() => setExpandedSku(isExpanded ? null : s.id)}>
                <div className="border border-border rounded-lg">
                  <CollapsibleTrigger asChild>
                    <div className="p-3 cursor-pointer space-y-1.5">
                      <div className="flex items-center justify-between">
                        <span className="font-mono text-xs font-medium">{s.sku_code}</span>
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-xs">{fmt(s.price)}</span>
                          <ChevronDown className={`h-3.5 w-3.5 text-muted-foreground transition-transform ${isExpanded ? "rotate-180" : ""}`} />
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
                        <span>{GRADE_LABELS[s.condition_grade] ?? s.condition_grade}</span>
                        <span>Stock: {s.stock_available}</span>
                        <span>Value: {fmt(s.carrying_value)}</span>
                      </div>
                      <div className="flex flex-wrap gap-1.5 pt-1.5 border-t border-border">
                        {CHANNELS.map((ch) => (
                          <div key={ch}>{renderChannelBadge(s, ch)}</div>
                        ))}
                      </div>
                    </div>
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    {listings.length > 0 && (
                      <div className="border-t border-border p-3 space-y-4">
                        {listings.map((cl) => (
                          <div key={cl.id}>
                            <div className="flex items-center gap-2 mb-1">
                              <Badge variant="outline" className="text-[10px]">
                                {CHANNEL_LABELS[cl.channel] ?? cl.channel}
                              </Badge>
                              <span className="font-mono text-[10px] text-muted-foreground">
                                {cl.external_sku}
                              </span>
                            </div>
                            <ChannelOverrideForm
                              listing={cl}
                              productName={product.name}
                              onInvalidate={onInvalidate}
                            />
                          </div>
                        ))}
                      </div>
                    )}
                  </CollapsibleContent>
                </div>
              </Collapsible>
            );
          })}
        </div>

        {/* Desktop table view */}
        <div className="hidden md:block">
          {product.skus.map((s) => {
            const listings = s.channel_listings;
            const isExpanded = expandedSku === s.id;
            const hasOverrides = listings.length > 0;
            return (
              <Collapsible key={s.id} open={isExpanded} onOpenChange={() => setExpandedSku(isExpanded ? null : s.id)}>
                <div className={`border-b border-border last:border-b-0 ${isExpanded ? "bg-muted/30" : ""}`}>
                  <CollapsibleTrigger asChild>
                    <div className="grid grid-cols-[1fr_auto_80px_60px_80px_1fr_auto] items-center gap-3 px-4 py-3 cursor-pointer hover:bg-muted/20 transition-colors">
                      <span className="font-mono text-xs font-medium">{s.sku_code}</span>
                      <span className="text-xs">{GRADE_LABELS[s.condition_grade] ?? s.condition_grade}</span>
                      <span className="text-xs text-right font-mono">{fmt(s.price)}</span>
                      <span className="text-xs text-right font-mono">{s.stock_available}</span>
                      <span className="text-xs text-right font-mono">{fmt(s.carrying_value)}</span>
                      <div className="flex items-center gap-2 justify-end">
                        {CHANNELS.map((ch) => (
                          <div key={ch}>{renderChannelBadge(s, ch)}</div>
                        ))}
                      </div>
                      {hasOverrides ? (
                        <ChevronDown className={`h-3.5 w-3.5 text-muted-foreground transition-transform ${isExpanded ? "rotate-180" : ""}`} />
                      ) : (
                        <div className="w-3.5" />
                      )}
                    </div>
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    {listings.length > 0 && (
                      <div className="px-4 pb-4 grid gap-4 md:grid-cols-2">
                        {listings.map((cl) => (
                          <div key={cl.id} className="border border-border rounded-lg p-3">
                            <div className="flex items-center gap-2 mb-1">
                              <Badge variant="outline" className="text-[10px]">
                                {CHANNEL_LABELS[cl.channel] ?? cl.channel}
                              </Badge>
                              {cl.offer_status && (
                                <Badge variant="outline" className="text-[10px]">{cl.offer_status}</Badge>
                              )}
                              <span className="font-mono text-[10px] text-muted-foreground">
                                {cl.external_sku}
                              </span>
                            </div>
                            <ChannelOverrideForm
                              listing={cl}
                              productName={product.name}
                              onInvalidate={onInvalidate}
                            />
                          </div>
                        ))}
                      </div>
                    )}
                  </CollapsibleContent>
                </div>
              </Collapsible>
            );
          })}

          {/* Column header hint */}
          <div className="grid grid-cols-[1fr_auto_80px_60px_80px_1fr_auto] items-center gap-3 px-4 py-1.5 border-t border-border bg-muted/20">
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground">SKU</span>
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Grade</span>
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground text-right">Price</span>
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground text-right">Stock</span>
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground text-right">Value</span>
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground text-right">Channels</span>
            <div className="w-3.5" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
