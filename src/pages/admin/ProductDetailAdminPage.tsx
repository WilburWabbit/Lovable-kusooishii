import { useState, useCallback } from "react";
import { useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { BackOfficeLayout } from "@/components/BackOfficeLayout";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { invokeWithAuth } from "@/lib/invokeWithAuth";

import { ProductHeader } from "@/components/admin/product-detail/ProductHeader";
import { ProductStatsCards } from "@/components/admin/product-detail/ProductStatsCards";
import { ProductIssuesBanner } from "@/components/admin/product-detail/ProductIssuesBanner";
import { ProductContentTab } from "@/components/admin/product-detail/ProductContentTab";
import { ProductMediaCard } from "@/components/admin/ProductMediaCard";
import { ProductChannelsTab } from "@/components/admin/product-detail/ProductChannelsTab";

import type { ProductDetail, BrickEconomyValuation } from "@/components/admin/product-detail/types";

export default function ProductDetailAdminPage() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState("content-media");

  const { data: product, isLoading } = useQuery({
    queryKey: ["admin-product", id],
    queryFn: () => invokeWithAuth<ProductDetail>("admin-data", { action: "get-product", product_id: id }),
    enabled: !!user && !!id,
  });

  const { data: beValuation } = useQuery({
    queryKey: ["be-valuation", product?.mpn],
    queryFn: async () => {
      const mpn = product!.mpn;
      const baseMpn = mpn.replace(/-\d+$/, "");
      const candidates = [mpn];
      if (baseMpn !== mpn) candidates.push(baseMpn);
      const { data } = await supabase
        .from("brickeconomy_collection")
        .select("item_number, name, current_value, growth, synced_at, condition")
        .in("item_number", candidates)
        .limit(1)
        .maybeSingle();
      return data as BrickEconomyValuation | null;
    },
    enabled: !!product?.mpn,
  });

  const handleInvalidate = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["admin-product", id] });
    queryClient.invalidateQueries({ queryKey: ["admin-products"] });
  }, [queryClient, id]);

  if (isLoading) {
    return (
      <BackOfficeLayout title="Product">
        <div className="flex items-center justify-center h-40 text-muted-foreground text-sm">Loading…</div>
      </BackOfficeLayout>
    );
  }

  if (!product) {
    return (
      <BackOfficeLayout title="Product">
        <div className="flex items-center justify-center h-40 text-muted-foreground text-sm">Product not found.</div>
      </BackOfficeLayout>
    );
  }

  return (
    <BackOfficeLayout title={product.name ?? product.mpn}>
      <div className="space-y-4 animate-fade-in">
        <ProductHeader product={product} />
        <ProductStatsCards product={product} />
        <ProductIssuesBanner product={product} onNavigateToTab={setActiveTab} />

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="w-full grid grid-cols-2">
            <TabsTrigger value="content-media">Content & Media</TabsTrigger>
            <TabsTrigger value="channels">Channels</TabsTrigger>
          </TabsList>

          <TabsContent value="content-media" className="mt-4 space-y-4">
            <ProductContentTab product={product} onInvalidate={handleInvalidate} />
            <ProductMediaCard productId={product.id} productName={product.name} mpn={product.mpn} />
          </TabsContent>

          <TabsContent value="channels" className="mt-4">
            <ProductChannelsTab product={product} beValuation={beValuation} onInvalidate={handleInvalidate} />
          </TabsContent>
        </Tabs>
      </div>
    </BackOfficeLayout>
  );
}
