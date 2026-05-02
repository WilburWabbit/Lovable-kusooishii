import { StorefrontLayout } from "@/components/StorefrontLayout";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useParams, Link } from "react-router-dom";
import { ShoppingBag, Heart, Shield, Package, ArrowLeft } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useState, useEffect, useRef } from "react";
import { GRADE_DETAILS } from "@/lib/grades";
import { useStore, type Product } from "@/lib/store";
import { trackViewItem } from "@/lib/gtm-ecommerce";
import { toast } from "sonner";
import { getStorefrontThemeName } from "@/lib/collectible-minifigs-theme";
import { usePageSeo } from "@/hooks/use-page-seo";

const SITE_URL = "https://www.kusooishii.com";
const UK_GEO_META = { region: "GB", placename: "United Kingdom" };

interface ProductDetailRow {
  id: string;
  mpn: string;
  name: string;
  description: string | null;
  product_hook: string | null;
  highlights: string | null;
  call_to_action: string | null;
  piece_count: number | null;
  release_year: number | null;
  retired_flag: boolean;
  product_type: string | null;
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
        .select("id, mpn, name, description, product_hook, highlights, call_to_action, piece_count, release_year, retired_flag, product_type, age_range, subtheme_name, length_cm, width_cm, height_cm, weight_kg, img_url, theme:theme_id(name)")
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

  // Fetch resolved canonical theme/subtheme from product_attribute (fallback when
  // product.theme_id / subtheme_name aren't projected yet).
  const { data: canonicalThemeAttrs } = useQuery({
    queryKey: ["product_canonical_theme_attrs", product?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("product_attribute")
        .select("key, chosen_source, custom_value, source_values_jsonb")
        .eq("product_id", product!.id)
        .eq("namespace", "core")
        .is("channel", null)
        .is("marketplace", null)
        .is("category_id", null)
        .in("key", ["theme", "subtheme"]);
      if (error) throw error;
      return (data ?? []) as Array<{
        key: string;
        chosen_source: string | null;
        custom_value: string | null;
        source_values_jsonb: Record<string, { value: string | null }> | null;
      }>;
    },
    enabled: !!product?.id,
  });

  function resolveCanonicalAttr(key: "theme" | "subtheme"): string | null {
    const row = canonicalThemeAttrs?.find((r) => r.key === key);
    if (!row) return null;
    if (row.chosen_source === "custom" && row.custom_value) return row.custom_value;
    if (row.chosen_source && row.chosen_source !== "none") {
      const v = row.source_values_jsonb?.[row.chosen_source]?.value;
      if (v && String(v).trim()) return String(v).trim();
    }
    if (row.chosen_source === "none") return null;
    // auto-priority fallback
    const priority = ["brickeconomy", "brickset", "bricklink", "brickowl"];
    for (const s of priority) {
      const v = row.source_values_jsonb?.[s]?.value;
      if (v && String(v).trim()) return String(v).trim();
    }
    return null;
  }

  const resolvedThemeName = resolveCanonicalAttr("theme");
  const resolvedSubthemeName = resolveCanonicalAttr("subtheme");

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
  const themeName =
    getStorefrontThemeName(product?.theme?.name ?? null, product?.product_type ?? null) ??
    resolvedThemeName;
  const subthemeName = product?.subtheme_name ?? resolvedSubthemeName;

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
  const canonicalProductUrl = product ? `${SITE_URL}/sets/${encodeURIComponent(product.mpn)}` : undefined;
  const structuredOffers = offers
    ?.filter((offer) => {
      const grade = parseInt(offer.condition_grade, 10);
      return offer.price != null && grade >= 1 && grade <= 5;
    })
    .map((offer) => ({
      '@type': 'Offer',
      sku: offer.sku_code,
      priceCurrency: 'GBP',
      price: offer.price,
      availability: offer.stock_count > 0 ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock',
      url: canonicalProductUrl,
    }));

  usePageSeo({
    title: product ? `${product.name} (${product.mpn})` : 'LEGO® Set',
    description: product?.description ?? `Shop ${product?.name ?? 'LEGO® sets'} with graded condition options and fast UK shipping from Kuso Oishii.`,
    path: mpn ? `/sets/${mpn}` : '/sets',
    imageUrl: primaryImageUrl ?? undefined,
    imageAlt: product ? `${product.name} product image` : undefined,
    keywords: product ? [product.mpn, product.name, 'LEGO resale', 'graded LEGO sets', 'UK LEGO store'] : undefined,
    geo: UK_GEO_META,
    jsonLd: product ? {
      '@context': 'https://schema.org',
      '@type': 'Product',
      name: product.name,
      mpn: product.mpn,
      description: product.description ?? undefined,
      image: allImageUrls.length ? allImageUrls : (primaryImageUrl ? [primaryImageUrl] : undefined),
      brand: { '@type': 'Brand', name: 'LEGO' },
      offers: structuredOffers,
    } : undefined
  });

  // Fire view_item event once per product load
  const viewItemFired = useRef<string | null>(null);
  useEffect(() => {
    if (!product || !offers?.length) return;
    if (viewItemFired.current === product.id) return;
    viewItemFired.current = product.id;
    const cheapest = offers.reduce((a, b) => ((a.price ?? Infinity) < (b.price ?? Infinity) ? a : b));
    trackViewItem({
      id: product.id,
      name: product.name,
      setNumber: product.mpn,
      price: cheapest.price ?? 0,
      rrp: 0,
      image: primaryImageUrl ?? "",
      images: allImageUrls,
      theme: themeName ?? "Uncategorised",
      themeId: null,
      pieceCount: product.piece_count ?? 0,
      condition: GRADE_DETAILS[cheapest.condition_grade]?.label ?? "",
      conditionGrade: parseInt(cheapest.condition_grade, 10),
      ageRange: product.age_range ?? "",
      hook: "",
      description: product.description ?? "",
      highlights: [],
      stock: cheapest.stock_count,
      retired: product.retired_flag,
      yearReleased: product.release_year,
    });
  }, [product, offers]);

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
      subtheme: subthemeName ?? undefined,
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
        <div className="flex flex-col items-center justify-center py-20 text-center max-w-md mx-auto">
          <p className="font-display text-2xl font-bold text-foreground">This isn't in stock right now.</p>
          <p className="mt-2 font-body text-sm text-muted-foreground">
            {mpn} might have sold out or been delisted. Try browsing our current stock or add it to your wishlist — we'll ping you if it comes back.
          </p>
          <div className="mt-6 flex gap-3">
            <Button asChild className="font-display text-xs">
              <Link to="/browse">Browse Stock</Link>
            </Button>
            <Button asChild variant="outline" className="font-display text-xs">
              <Link to="/signup">Create Account</Link>
            </Button>
          </div>
        </div>
      </StorefrontLayout>
    );
  }

  return (
    <StorefrontLayout>
      <div className="bg-background overflow-hidden">
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
              <div className="min-w-0">
                {displayMedia.length > 0 ? (
                  <div className="space-y-3">
                    <div className="aspect-square bg-background overflow-hidden border border-border relative">
                      <img
                        src={displayMedia[selectedImage]?.url}
                        alt={displayMedia[selectedImage]?.alt || product.name || ""}
                        className="absolute inset-0 h-full w-full object-contain"
                      />
                    </div>
                    {displayMedia.length > 1 && (
                      <div className="flex gap-2 overflow-x-auto pb-1">
                        {displayMedia.map((img, idx) => (
                          <button
                            key={img.id}
                            onClick={() => setSelectedImage(idx)}
                            className={`h-16 w-16 shrink-0 overflow-hidden border-2 transition-colors relative ${
                              idx === selectedImage ? "border-primary" : "border-border hover:border-muted-foreground"
                            }`}
                          >
                            <img src={img.url} alt={img.alt || ""} className="absolute inset-0 h-full w-full object-contain" />
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
              <div className="min-w-0">
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

                {product.product_hook && (
                  <p className="mt-4 font-body text-sm leading-relaxed font-bold text-foreground">
                    {product.product_hook}
                  </p>
                )}

                {product.description && (
                  <p className="mt-4 font-body text-sm leading-relaxed text-muted-foreground whitespace-pre-line">
                    {product.description}
                  </p>
                )}

                {product.highlights && (() => {
                  const items = product.highlights
                    .split(/\r?\n+/)
                    .map((line) => line.replace(/^[\s•\-*]+/, "").trim())
                    .filter(Boolean);
                  if (items.length === 0) return null;
                  return (
                    <ul className="mt-4 list-disc pl-5 font-body text-sm leading-relaxed text-muted-foreground space-y-1">
                      {items.map((item, idx) => (
                        <li key={idx}>{item}</li>
                      ))}
                    </ul>
                  );
                })()}

                {product.call_to_action && (
                  <p className="mt-4 font-body text-sm leading-relaxed font-bold text-foreground">
                    {product.call_to_action}
                  </p>
                )}

                <div className="mt-6 flex gap-4 sm:gap-6 border-t border-b border-border py-4 flex-wrap">
                  {(() => {
                    const specs: { label: string; value: string }[] = [];
                    if (themeName) specs.push({ label: "Theme", value: themeName });
                    if (subthemeName) specs.push({ label: "Subtheme", value: subthemeName });
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


                {/* Offers by grade */}
                <div className="mt-6 space-y-3">
                  <h3 className="font-display text-xs font-semibold uppercase tracking-widest text-foreground">
                    Available Conditions
                  </h3>
                  {offers && offers.length > 0 ? (
                    offers.map((offer) => (
                      <div
                        key={offer.sku_id}
                        className="flex flex-wrap items-center justify-between gap-3 border border-border p-4 transition-colors hover:border-primary"
                      >
                        <div className="flex items-center gap-3 min-w-0 max-w-full sm:max-w-[60%]">
                          <Link to="/grading" className="shrink-0">
                            <img
                              src={GRADE_DETAILS[offer.condition_grade]?.icon}
                              alt={`Grade ${offer.condition_grade} — ${GRADE_DETAILS[offer.condition_grade]?.label}`}
                              className="h-10 w-10 object-contain"
                            />
                          </Link>
                          <div>
                            <p className="font-display text-sm font-semibold text-foreground">
                              {GRADE_DETAILS[offer.condition_grade]?.label ?? `Grade ${offer.condition_grade}`}
                            </p>
                            <p className="font-body text-xs text-muted-foreground">
                              {GRADE_DETAILS[offer.condition_grade]?.shortDesc ?? ""}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-4">
                          <div className="text-right">
                            <p className="font-display text-lg font-bold text-foreground">
                              {offer.price != null ? `£${Number(offer.price).toFixed(2)}` : "—"}
                            </p>
                            {offer.price != null && (
                              <p className="font-body text-[10px] text-muted-foreground">inc. VAT</p>
                            )}
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
