import { StorefrontLayout } from "@/components/StorefrontLayout";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useParams, Link } from "react-router-dom";
import { ShoppingBag, Heart, Shield, Package, ArrowLeft } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useState } from "react";
import { GRADE_DETAILS } from "@/lib/grades";
import { useStore, type Product } from "@/lib/store";
import { toast } from "sonner";

interface ProductDetailRow {
  id: string;
  mpn: string;
  name: string;
  description: string | null;
  piece_count: number | null;
  release_year: number | null;
  retired_flag: boolean;
  age_range: string | null;
  subtheme_name: string | null;
  length_cm: number | null;
  width_cm: number | null;
  height_cm: number | null;
  weight_kg: number | null;
  img_url: string | null;
  theme: { name: string } | null;
}

interface Offer {
  sku_id: string;
  sku_code: string;
  condition_grade: string;
  price: number | null;
  stock_count: number;
}

interface MediaItem {
  id: string;
  url: string;
  alt: string;
  is_primary: boolean;
}

export default function ProductDetailPage() {
  const { mpn } = useParams<{ mpn: string }>();
  const { addToCart, addToWishlist, isInWishlist } = useStore();

  // Fetch product
  const { data: product, isLoading: productLoading } = useQuery({
    queryKey: ["product", mpn],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("product")
        .select("id, mpn, name, description, piece_count, release_year, retired_flag, age_range, subtheme_name, length_cm, width_cm, height_cm, weight_kg, img_url, theme:theme_id(name)")
        .eq("mpn", mpn!)
        .eq("status", "active")
        .maybeSingle();
      if (error) throw error;
      return data as ProductDetailRow | null;
    },
    enabled: !!mpn,
  });

  // Fetch offers
  const { data: offers, isLoading: offersLoading } = useQuery({
    queryKey: ["product_offers", mpn],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("product_detail_offers", { p_mpn: mpn! });
      if (error) throw error;
      return data as Offer[];
    },
    enabled: !!mpn,
  });

  // Fetch BrickEconomy enrichment data
  const { data: beData } = useQuery({
    queryKey: ["brickeconomy_enrichment", mpn],
    queryFn: async () => {
      const setNumber = mpn!.split("-")[0];
      const { data, error } = await supabase
        .from("brickeconomy_collection")
        .select("minifigs_count, retail_price, current_value, growth, retired_date, currency")
        .eq("item_number", setNumber)
        .eq("item_type", "set")
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!mpn,
  });

  // Fetch catalog image from lego_catalog by MPN
  const { data: catalogImgUrl } = useQuery<string | null>({
    queryKey: ["catalog-img-storefront", mpn],
    queryFn: async () => {
      const { data } = await supabase
        .from("lego_catalog")
        .select("img_url")
        .eq("mpn", mpn!)
        .maybeSingle();
      return data?.img_url ?? null;
    },
    enabled: !!mpn,
    staleTime: 60_000,
  });

  // Fetch include_catalog_img flag (separate query — resilient if column doesn't exist yet)
  const { data: includeCatalogImg = false } = useQuery({
    queryKey: ["include-catalog-img", product?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from("product")
        .select("include_catalog_img")
        .eq("id", product!.id)
        .maybeSingle();
      return (data as any)?.include_catalog_img ?? false;
    },
    enabled: !!product?.id,
  });

  // Fetch product media
  const { data: mediaItems = [] } = useQuery<MediaItem[]>({
    queryKey: ["product_media_storefront", product?.id],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("product_media")
        .select("id, sort_order, is_primary, media_asset:media_asset_id(original_url, alt_text)")
        .eq("product_id", product!.id)
        .order("sort_order", { ascending: true });
      if (error) throw error;
      return (data ?? []).map((pm: any) => ({
        id: pm.id,
        url: pm.media_asset?.original_url,
        alt: pm.media_asset?.alt_text ?? "",
        is_primary: pm.is_primary,
      }));
    },
    enabled: !!product?.id,
  });

  const [selectedImage, setSelectedImage] = useState(0);

  const isLoading = productLoading || offersLoading;
  const themeName = product?.theme?.name ?? null;

  // Append catalog image as the final gallery item when include_catalog_img is enabled
  const displayMedia: MediaItem[] = (() => {
    const base = [...mediaItems];
    if (includeCatalogImg && catalogImgUrl) {
      base.push({
        id: "__catalog__",
        url: catalogImgUrl,
        alt: product.name ?? "Catalog image",
        is_primary: false,
      });
    }
    return base;
  })();

  const primaryImageUrl = displayMedia.find(m => m.is_primary)?.url ?? displayMedia[0]?.url ?? null;
  const allImageUrls = displayMedia.map(m => m.url).filter(Boolean);
  const inWishlist = product ? isInWishlist(product.id) : false;

  function buildCartProduct(p: ProductDetailRow, offer: Offer): Product {
    return {
      id: offer.sku_id,
      name: p.name,
      setNumber: p.mpn,
      price: offer.price ?? 0,
      rrp: beData?.retail_price ?? 0,
      image: primaryImageUrl ?? "",
      images: allImageUrls,
      theme: themeName ?? "Uncategorised",
      themeId: null,
      pieceCount: p.piece_count ?? 0,
      condition: GRADE_DETAILS[offer.condition_grade]?.label ?? `Grade ${offer.condition_grade}`,
      conditionGrade: parseInt(offer.condition_grade, 10),
      ageRange: p.age_range ?? "",
      hook: "",
      description: p.description ?? "",
      highlights: [],
      stock: offer.stock_count,
      retired: p.retired_flag,
      yearReleased: p.release_year,
      subtheme: p.subtheme_name ?? undefined,
      weightKg: p.weight_kg ?? undefined,
    };
  }

  function handleAddToCart(offer: Offer) {
    if (!product) return;
    addToCart(buildCartProduct(product, offer));
    toast.success(`${product.name} (${GRADE_DETAILS[offer.condition_grade]?.label ?? "Grade " + offer.condition_grade}) added to cart`);
  }

  function handleToggleWishlist() {
    if (!product) return;
    if (inWishlist) return;
    addToWishlist(product.id);
    toast.success("Added to wishlist");
  }

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
              {/* Image gallery */}
              <div>
                {displayMedia.length > 0 ? (
                  <div className="space-y-3">
                    <div className="aspect-square bg-background overflow-hidden border border-border">
                      <img
                        src={displayMedia[selectedImage]?.url}
                        alt={displayMedia[selectedImage]?.alt || product.name || ""}
                        className="h-full w-full object-contain"
                      />
                    </div>
                    {displayMedia.length > 1 && (
                      <div className="flex gap-2 overflow-x-auto pb-1">
                        {displayMedia.map((img, idx) => (
                          <button
                            key={img.id}
                            onClick={() => setSelectedImage(idx)}
                            className={`h-16 w-16 shrink-0 overflow-hidden border-2 transition-colors ${
                              idx === selectedImage ? "border-primary" : "border-border hover:border-muted-foreground"
                            }`}
                          >
                            <img src={img.url} alt={img.alt || ""} className="h-full w-full object-contain" />
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="aspect-square bg-kuso-mist flex items-center justify-center">
                    <span className="font-display text-6xl font-bold text-muted-foreground/15">
                      {product.mpn.split("-")[0]}
                    </span>
                  </div>
                )}
              </div>

              {/* Product info */}
              <div>
                <div className="flex items-center gap-2">
                  {themeName && <span className="font-body text-xs text-muted-foreground">{themeName}</span>}
                  <span className="font-body text-xs text-muted-foreground">·</span>
                  <span className="font-body text-xs text-muted-foreground">{product.mpn}</span>
                  {product.retired_flag && (
                    <Badge variant="destructive" className="ml-auto font-display text-[10px] uppercase tracking-wider">
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

                <div className="mt-6 flex gap-6 border-t border-b border-border py-4 flex-wrap">
                  {(() => {
                    const specs: { label: string; value: string }[] = [];
                    if (themeName) specs.push({ label: "Theme", value: themeName });
                    if (product.subtheme_name) specs.push({ label: "Subtheme", value: product.subtheme_name });
                    if (product.release_year) specs.push({ label: "Released", value: String(product.release_year) });
                    if (product.retired_flag && beData?.retired_date) specs.push({ label: "Retired", value: beData.retired_date });
                    if (product.piece_count) specs.push({ label: "Pieces", value: product.piece_count.toLocaleString() });
                    if (beData?.minifigs_count) specs.push({ label: "Minifigs", value: String(beData.minifigs_count) });
                    if (product.age_range) specs.push({ label: "Ages", value: product.age_range });
                    if ((offers?.length ?? 0) > 1) specs.push({ label: "Variants", value: String(offers?.length ?? 0) });
                    return specs.map((s) => (
                      <div key={s.label}>
                        <p className="font-display text-xs font-semibold uppercase tracking-widest text-muted-foreground">{s.label}</p>
                        <p className="mt-1 font-display text-sm font-bold text-foreground">{s.value}</p>
                      </div>
                    ));
                  })()}
                </div>

                {/* Dimensions */}
                {(product.length_cm || product.width_cm || product.height_cm || product.weight_kg) && (
                  <div className="mt-4 flex gap-6 flex-wrap">
                    {product.length_cm != null && product.width_cm != null && product.height_cm != null && (
                      <div>
                        <p className="font-display text-xs font-semibold uppercase tracking-widest text-muted-foreground">Dimensions</p>
                        <p className="mt-1 font-display text-sm font-bold text-foreground">
                          {product.length_cm} × {product.width_cm} × {product.height_cm} cm
                        </p>
                      </div>
                    )}
                    {product.length_cm != null && product.width_cm != null && product.height_cm != null && (
                      <div>
                        <p className="font-display text-xs font-semibold uppercase tracking-widest text-muted-foreground">Girth</p>
                        <p className="mt-1 font-display text-sm font-bold text-foreground">
                          {(2 * ((product.width_cm ?? 0) + (product.height_cm ?? 0))).toFixed(1)} cm
                        </p>
                      </div>
                    )}
                    {product.weight_kg != null && (
                      <div>
                        <p className="font-display text-xs font-semibold uppercase tracking-widest text-muted-foreground">Weight</p>
                        <p className="mt-1 font-display text-sm font-bold text-foreground">{product.weight_kg} kg</p>
                      </div>
                    )}
                  </div>
                )}

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
                        <div className="flex items-center gap-3 max-w-[60%]">
                          <div className="flex h-8 w-8 items-center justify-center bg-foreground font-display text-xs font-bold text-background">
                            G{offer.condition_grade}
                          </div>
                          <div>
                            <p className="font-display text-sm font-semibold text-foreground">
                              {GRADE_DETAILS[offer.condition_grade]?.label ?? `Grade ${offer.condition_grade}`}
                            </p>
                            <p className="font-body text-xs text-muted-foreground">
                              {GRADE_DETAILS[offer.condition_grade]?.desc ?? ""}
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
                          <Button
                            size="sm"
                            className="font-display text-xs font-semibold"
                            disabled={offer.price == null || offer.stock_count === 0}
                            onClick={() => handleAddToCart(offer)}
                          >
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
                  <Button
                    variant="outline"
                    size="sm"
                    className="font-display text-xs"
                    onClick={handleToggleWishlist}
                  >
                    <Heart className={`mr-1.5 h-3.5 w-3.5 ${inWishlist ? "fill-current" : ""}`} />
                    {inWishlist ? "In Wishlist" : "Add to Wishlist"}
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
