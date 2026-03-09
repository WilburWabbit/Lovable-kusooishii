import { StorefrontLayout } from "@/components/StorefrontLayout";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useParams, Link } from "react-router-dom";
import { ShoppingBag, Heart, Shield, Package, ArrowLeft } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

const gradeLabels: Record<string, { label: string; desc: string }> = {
  "1": { label: "Mint", desc: "Box and contents in near-perfect condition. No visible damage, creasing, or shelf wear." },
  "2": { label: "Excellent", desc: "Minor shelf wear or light marks. Contents complete and in great condition." },
  "3": { label: "Good", desc: "Noticeable wear, minor creasing, or small marks. Contents complete." },
  "4": { label: "Acceptable", desc: "Significant wear, dents or tears. All pieces present but box shows heavy use." },
  "5": { label: "Fair", desc: "Heavy wear or damage. May have missing non-essential items." },
};

export default function ProductDetailPage() {
  const { mpn } = useParams<{ mpn: string }>();

  // Fetch product
  const { data: product, isLoading: productLoading } = useQuery({
    queryKey: ["product", mpn],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("catalog_product")
        .select("id, mpn, name, description, piece_count, release_year, retired_flag, theme:theme_id(name)")
        .eq("mpn", mpn!)
        .eq("status", "active")
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!mpn,
  });

  // Fetch offers
  const { data: offers, isLoading: offersLoading } = useQuery({
    queryKey: ["product_offers", mpn],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("product_detail_offers", { p_mpn: mpn! });
      if (error) throw error;
      return data as { sku_id: string; sku_code: string; condition_grade: string; price: number | null; stock_count: number }[];
    },
    enabled: !!mpn,
  });

  const isLoading = productLoading || offersLoading;
  const themeName = product?.theme && typeof product.theme === "object" && !Array.isArray(product.theme)
    ? (product.theme as { name: string }).name
    : null;

  if (!isLoading && !product) {
    return (
      <StorefrontLayout>
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <p className="font-display text-2xl font-bold text-foreground">Set not found</p>
          <p className="mt-2 font-body text-sm text-muted-foreground">
            We couldn't find a product with MPN "{mpn}".
          </p>
          <Button asChild variant="outline" className="mt-6 font-display text-xs">
            <Link to="/browse"><ArrowLeft className="mr-1.5 h-3.5 w-3.5" /> Back to browse</Link>
          </Button>
        </div>
      </StorefrontLayout>
    );
  }

  return (
    <StorefrontLayout>
      <div className="bg-background">
        {/* Breadcrumb */}
        <div className="border-b border-border bg-kuso-paper">
          <div className="container flex items-center gap-2 py-3">
            <Link to="/browse" className="flex items-center gap-1 font-body text-xs text-muted-foreground hover:text-foreground">
              <ArrowLeft className="h-3 w-3" /> Back to browse
            </Link>
            {themeName && (
              <>
                <span className="font-body text-xs text-muted-foreground">/</span>
                <span className="font-body text-xs text-muted-foreground">{themeName}</span>
              </>
            )}
            <span className="font-body text-xs text-muted-foreground">/</span>
            <span className="font-body text-xs text-foreground">{mpn}</span>
          </div>
        </div>

        <div className="container py-8 lg:py-12">
          {isLoading ? (
            <div className="grid gap-10 lg:grid-cols-2">
              <Skeleton className="aspect-square w-full rounded-none" />
              <div className="space-y-4">
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-8 w-64" />
                <Skeleton className="h-20 w-full" />
                <Skeleton className="h-16 w-full" />
                <Skeleton className="h-24 w-full" />
              </div>
            </div>
          ) : product ? (
            <div className="grid gap-10 lg:grid-cols-2">
              {/* Image placeholder */}
              <div className="aspect-square bg-kuso-mist flex items-center justify-center">
                <span className="font-display text-6xl font-bold text-muted-foreground/15">
                  {product.mpn.split("-")[0]}
                </span>
              </div>

              {/* Product info */}
              <div>
                <div className="flex items-center gap-2">
                  {themeName && <span className="font-body text-xs text-muted-foreground">{themeName}</span>}
                  <span className="font-body text-xs text-muted-foreground">·</span>
                  <span className="font-body text-xs text-muted-foreground">{product.mpn}</span>
                  {product.retired_flag && (
                    <Badge variant="destructive" className="font-display text-[10px] uppercase tracking-wider">
                      Retired
                    </Badge>
                  )}
                </div>

                <h1 className="mt-3 font-display text-2xl font-bold text-foreground lg:text-3xl">
                  {product.name}
                </h1>

                {product.description && (
                  <p className="mt-4 font-body text-sm leading-relaxed text-muted-foreground">
                    {product.description}
                  </p>
                )}

                <div className="mt-6 flex gap-6 border-t border-b border-border py-4">
                  {product.piece_count && (
                    <div>
                      <p className="font-display text-xs font-semibold uppercase tracking-widest text-muted-foreground">Pieces</p>
                      <p className="mt-1 font-display text-sm font-bold text-foreground">{product.piece_count.toLocaleString()}</p>
                    </div>
                  )}
                  {product.release_year && (
                    <div>
                      <p className="font-display text-xs font-semibold uppercase tracking-widest text-muted-foreground">Released</p>
                      <p className="mt-1 font-display text-sm font-bold text-foreground">{product.release_year}</p>
                    </div>
                  )}
                  <div>
                    <p className="font-display text-xs font-semibold uppercase tracking-widest text-muted-foreground">Variants</p>
                    <p className="mt-1 font-display text-sm font-bold text-foreground">{offers?.length ?? 0}</p>
                  </div>
                </div>

                {/* Offers by grade */}
                <div className="mt-6 space-y-3">
                  <h3 className="font-display text-xs font-semibold uppercase tracking-widest text-foreground">
                    Available Conditions
                  </h3>
                  {offers && offers.length > 0 ? (
                    offers.map((offer) => (
                      <div
                        key={offer.sku_id}
                        className="flex items-center justify-between border border-border p-4 transition-colors hover:border-primary"
                      >
                        <div className="flex items-center gap-3">
                          <div className="flex h-8 w-8 items-center justify-center bg-foreground font-display text-xs font-bold text-background">
                            G{offer.condition_grade}
                          </div>
                          <div>
                            <p className="font-display text-sm font-semibold text-foreground">
                              {gradeLabels[offer.condition_grade]?.label ?? `Grade ${offer.condition_grade}`}
                            </p>
                            <p className="font-body text-xs text-muted-foreground">
                              {gradeLabels[offer.condition_grade]?.desc ?? ""}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-4">
                          <div className="text-right">
                            <p className="font-display text-lg font-bold text-foreground">
                              {offer.price != null ? `£${Number(offer.price).toFixed(2)}` : "—"}
                            </p>
                            <p className="font-body text-[11px] text-muted-foreground">
                              {offer.stock_count} in stock
                            </p>
                          </div>
                          <Button size="sm" className="font-display text-xs font-semibold">
                            <ShoppingBag className="mr-1.5 h-3.5 w-3.5" /> Add
                          </Button>
                        </div>
                      </div>
                    ))
                  ) : (
                    <p className="font-body text-sm text-muted-foreground">No stock currently available.</p>
                  )}
                </div>

                {/* Actions */}
                <div className="mt-6 flex gap-2">
                  <Button variant="outline" size="sm" className="font-display text-xs">
                    <Heart className="mr-1.5 h-3.5 w-3.5" /> Add to Wishlist
                  </Button>
                </div>

                {/* Trust signals */}
                <div className="mt-8 grid grid-cols-2 gap-3">
                  <div className="flex items-start gap-2 rounded bg-kuso-paper p-3">
                    <Shield className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                    <div>
                      <p className="font-display text-xs font-semibold text-foreground">Condition Verified</p>
                      <p className="font-body text-[11px] text-muted-foreground">Inspected & graded before listing</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-2 rounded bg-kuso-paper p-3">
                    <Package className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                    <div>
                      <p className="font-display text-xs font-semibold text-foreground">Secure Shipping</p>
                      <p className="font-body text-[11px] text-muted-foreground">Double-boxed & insured</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </StorefrontLayout>
  );
}
