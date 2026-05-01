// ============================================================
// Admin V2 — Product Hooks
// Covers: useProducts, useProduct, useUpdateProductCopy,
//         useUpdateConditionNotes, useUploadProductImage
// ============================================================

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type {
  Product,
  ProductVariant,
  ProductImage,
  ProductDetail,
  BrickEconomyData,
  FieldOverride,
  ConditionGrade,
  ProductVariantPricing,
} from '@/lib/types/admin';

// ─── Query Keys ─────────────────────────────────────────────

export const productKeys = {
  all: ['v2', 'products'] as const,
  detail: (mpn: string) => ['v2', 'products', mpn] as const,
};

// ─── Row → Interface Mappers ────────────────────────────────

function mapProduct(row: Record<string, unknown>): Product {
  const theme = row.theme as Record<string, unknown> | null;
  return {
    id: row.id as string,
    mpn: row.mpn as string,
    name: (row.name as string) ?? '',
    brand: (row.brand as string) ?? null,
    productType: (['minifig', 'minifigure'].includes(row.product_type as string) ? 'minifig' : 'set') as "set" | "minifig",
    theme: theme ? (theme.name as string) : null,
    subtheme: (row.subtheme_name as string) ?? null,
    setNumber: (row.set_number as string) ?? null,
    pieceCount: (row.piece_count as number) ?? null,
    ageMark: (row.age_range as string) ?? null,
    ean: (row.ean as string) ?? null,
    releaseDate: (row.released_date as string) ?? null,
    retiredDate: (row.retired_date as string) ?? null,
    dimensionsCm: buildDimensions(row),
    weightG: row.weight_kg != null ? Math.round((row.weight_kg as number) * 1000) : null,
    hook: (row.product_hook as string) ?? null,
    description: (row.description as string) ?? null,
    highlights: (row.highlights as string) ?? null,
    cta: (row.call_to_action as string) ?? null,
    seoTitle: (row.seo_title as string) ?? null,
    seoDescription: (row.seo_description as string) ?? null,
    ebayCategoryId: (row.ebay_category_id as string) ?? null,
    createdAt: row.created_at as string,
  };
}

function buildDimensions(row: Record<string, unknown>): string | null {
  const l = row.length_cm as number | null;
  const w = row.width_cm as number | null;
  const h = row.height_cm as number | null;
  if (l == null && w == null && h == null) return null;
  return `${l ?? '?'} × ${w ?? '?'} × ${h ?? '?'}`;
}

function mapVariant(row: Record<string, unknown>): ProductVariant {
  return {
    id: row.id as string,
    sku: row.sku_code as string,
    mpn: row.mpn as string,
    grade: Number(row.condition_grade) as ConditionGrade,
    stripeProductId: (row.stripe_product_id as string) ?? null,
    stripePriceId: (row.stripe_price_id as string) ?? null,
    salePrice: null,
    floorPrice: null,
    avgCost: null,
    costRange: null,
    qtyOnHand: (row.qty_on_hand as number) ?? 0,
    conditionNotes: (row.condition_notes as string) ?? null,
    marketPrice: (row.market_price as number) ?? null,
    createdAt: row.created_at as string,
  };
}

function mapVariantPricing(row: Record<string, unknown>): ProductVariantPricing {
  return {
    skuId: row.sku_id as string,
    skuCode: row.sku_code as string,
    channel: (row.channel as ProductVariantPricing['channel']) ?? null,
    currentPrice: (row.current_price as number) ?? null,
    floorPrice: (row.floor_price as number) ?? null,
    marketPrice: (row.market_price as number) ?? null,
    avgCost: (row.avg_cost as number) ?? null,
    costRange: (row.cost_range as string) ?? null,
    confidenceScore: (row.confidence_score as number) ?? null,
    pricedAt: (row.priced_at as string) ?? null,
  };
}

function preferredPricing(
  rows: ProductVariantPricing[],
): Map<string, ProductVariantPricing> {
  const rank = (row: ProductVariantPricing) => {
    if (row.channel === 'website' || row.channel === 'web') return 3;
    if (row.channel == null) return 2;
    return 1;
  };

  const bySku = new Map<string, ProductVariantPricing>();
  for (const row of rows) {
    const existing = bySku.get(row.skuCode);
    if (!existing) {
      bySku.set(row.skuCode, row);
      continue;
    }

    const rankDiff = rank(row) - rank(existing);
    if (rankDiff > 0) {
      bySku.set(row.skuCode, row);
      continue;
    }

    if (rankDiff === 0) {
      const tNew = new Date(row.pricedAt ?? 0).getTime();
      const tOld = new Date(existing.pricedAt ?? 0).getTime();
      if (tNew > tOld) bySku.set(row.skuCode, row);
    }
  }
  return bySku;
}

function applyPricing(variant: ProductVariant, pricing: ProductVariantPricing | undefined): ProductVariant {
  if (!pricing) return variant;

  return {
    ...variant,
    salePrice: pricing.currentPrice ?? variant.salePrice,
    floorPrice: pricing.floorPrice ?? variant.floorPrice,
    avgCost: pricing.avgCost ?? variant.avgCost,
    costRange: pricing.costRange ?? variant.costRange,
    marketPrice: pricing.marketPrice ?? variant.marketPrice,
  };
}

function mapImage(
  pm: Record<string, unknown>,
  ma: Record<string, unknown>,
  productMpn: string,
): ProductImage {
  return {
    id: pm.id as string,
    mediaAssetId: ma.id as string,
    mpn: productMpn,
    storagePath: ma.original_url as string,
    altText: (ma.alt_text as string) ?? null,
    sortOrder: (pm.sort_order as number) ?? 0,
    isPrimary: (pm.is_primary as boolean) ?? false,
  };
}

function mapBrickEconomyData(row: Record<string, unknown>): BrickEconomyData {
  return {
    theme: (row.theme as string) ?? null,
    subtheme: (row.subtheme as string) ?? null,
    piecesCount: (row.pieces_count as number) ?? null,
    year: (row.year as number) ?? null,
    releasedDate: (row.released_date as string) ?? null,
    retiredDate: (row.retired_date as string) ?? null,
    retailPrice: (row.retail_price as number) ?? null,
    minifigsCount: (row.minifigs_count as number) ?? null,
  };
}

// ─── useProducts ────────────────────────────────────────────

export function useProducts() {
  return useQuery({
    queryKey: productKeys.all,
    queryFn: async () => {
      // Fetch products with theme join
      const { data, error } = await supabase
        .from('product')
        .select('*, theme:theme_id(name)')
        .order('name', { ascending: true });

      if (error) throw error;
      const products = ((data ?? []) as Record<string, unknown>[]).map(mapProduct);

      // Fetch variant summaries from the v2 view
      const { data: variantRows } = await supabase
        .from('v2_variant_stock_summary' as never)
        .select('*');

      const { data: pricingRows } = await supabase
        .from('v_current_sku_pricing' as never)
        .select('sku_id, sku_code, channel, current_price, floor_price, market_price, avg_cost, cost_range, confidence_score, priced_at');

      const pricingBySku = preferredPricing(
        ((pricingRows ?? []) as Record<string, unknown>[]).map(mapVariantPricing),
      );

      // Build a lookup of variants per product MPN
      const variantsByMpn = new Map<string, ProductVariant[]>();
      for (const row of ((variantRows ?? []) as Record<string, unknown>[])) {
        const mpn = row.mpn as string;
        const list = variantsByMpn.get(mpn) ?? [];
        const variant = mapVariant(row);
        list.push(applyPricing(variant, pricingBySku.get(variant.sku)));
        variantsByMpn.set(mpn, list);
      }

      return products.map((p) => ({
        ...p,
        variants: variantsByMpn.get(p.mpn) ?? [],
      }));
    },
  });
}

// ─── useProductStockCounts ───────────────────────────────────

export interface ProductStockCounts {
  purchased: number;
  unlisted: number;
  unsold: number;
  onHand: number;
  sold: number;
}

const SOLD_STATUSES = ['sold', 'shipped', 'delivered', 'payout_received', 'complete'];

export function useProductStockCounts() {
  return useQuery({
    queryKey: ['v2', 'product-stock-counts'] as const,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('stock_unit')
        .select('mpn, v2_status' as never);

      if (error) throw error;

      const counts = new Map<string, ProductStockCounts>();

      for (const row of ((data ?? []) as unknown as Record<string, unknown>[])) {
        const mpn = row.mpn as string;
        const status = (row.v2_status as string) ?? 'purchased';
        if (!mpn) continue;

        let entry = counts.get(mpn);
        if (!entry) {
          entry = { purchased: 0, unlisted: 0, unsold: 0, onHand: 0, sold: 0 };
          counts.set(mpn, entry);
        }

        entry.purchased += 1;
        if (status === 'graded') { entry.unlisted += 1; entry.onHand += 1; }
        else if (status === 'listed') { entry.unsold += 1; entry.onHand += 1; }
        else if (SOLD_STATUSES.includes(status)) entry.sold += 1;
      }

      return counts;
    },
  });
}

// ─── useProduct ─────────────────────────────────────────────

export function useProduct(mpn: string | undefined) {
  return useQuery({
    queryKey: productKeys.detail(mpn ?? ''),
    enabled: !!mpn,
    queryFn: async (): Promise<ProductDetail> => {
      // Fetch product
      const { data: productRow, error: prodErr } = await supabase
        .from('product')
        .select('*, theme:theme_id(name)')
        .eq('mpn', mpn!)
        .single();

      if (prodErr) throw prodErr;
      const product = mapProduct(productRow as Record<string, unknown>);

      // Fetch variants (SKUs) for this product
      const productId = (productRow as Record<string, unknown>).id as string;
      const { data: skuRows, error: skuErr } = await supabase
        .from('sku')
        .select('*')
        .eq('product_id', productId)
        .order('condition_grade', { ascending: true });

      if (skuErr) throw skuErr;

      // Fetch variant stock counts from the view
      const { data: summaryRows } = await supabase
        .from('v2_variant_stock_summary' as never)
        .select('*')
        .eq('mpn' as never, mpn!);

      const summaryByCode = new Map<string, Record<string, unknown>>();
      for (const row of ((summaryRows ?? []) as Record<string, unknown>[])) {
        summaryByCode.set(row.sku_code as string, row);
      }

      const { data: pricingRows } = await supabase
        .from('v_current_sku_pricing' as never)
        .select('sku_id, sku_code, channel, current_price, floor_price, market_price, avg_cost, cost_range, confidence_score, priced_at')
        .eq('mpn' as never, mpn!);

      const pricingBySku = preferredPricing(
        ((pricingRows ?? []) as Record<string, unknown>[]).map(mapVariantPricing),
      );

      const variants: ProductVariant[] = ((skuRows ?? []) as Record<string, unknown>[]).map((row) => {
        const code = row.sku_code as string;
        const summary = summaryByCode.get(code);
        const variant = {
          ...mapVariant({ ...row, mpn: mpn! }),
          qtyOnHand: summary ? (summary.qty_on_hand as number) ?? 0 : 0,
          avgCost: summary ? (summary.avg_cost as number) ?? null : null,
          floorPrice: null,
        };
        return applyPricing(variant, pricingBySku.get(code));
      });

      // Fetch images
      const { data: mediaRows } = await supabase
        .from('product_media')
        .select('*, media_asset:media_asset_id(*)')
        .eq('product_id', productId)
        .order('sort_order', { ascending: true });

      const images: ProductImage[] = ((mediaRows ?? []) as Record<string, unknown>[]).map((pm) => {
        const ma = pm.media_asset as Record<string, unknown>;
        return mapImage(pm, ma, mpn!);
      });

      // Fetch latest BrickEconomy data for this MPN
      const setNumber = mpn!.split('-')[0];
      const { data: beRow } = await supabase
        .from('brickeconomy_collection')
        .select('*')
        .eq('item_number' as never, setNumber)
        .order('synced_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      const brickeconomyData: BrickEconomyData | null = beRow
        ? mapBrickEconomyData(beRow as Record<string, unknown>)
        : null;

      // Fetch catalog image if linked
      let catalogImageUrl: string | null = null;
      const rawProduct = productRow as Record<string, unknown>;
      const catalogId = rawProduct.lego_catalog_id as string | null;
      if (catalogId) {
        const { data: catRow } = await supabase
          .from('lego_catalog' as never)
          .select('img_url' as never)
          .eq('id' as never, catalogId)
          .maybeSingle();
        catalogImageUrl = catRow
          ? ((catRow as Record<string, unknown>).img_url as string) ?? null
          : null;
      }

      const includeCatalogImg = (rawProduct.include_catalog_img as boolean) ?? false;
      const fieldOverrides = (rawProduct.field_overrides as Record<string, FieldOverride>) ?? {};
      const selectedMinifigFigNums = Array.isArray(rawProduct.selected_minifig_fig_nums)
        ? (rawProduct.selected_minifig_fig_nums as unknown[])
            .filter((v): v is string => typeof v === 'string')
        : [];

      return {
        ...product,
        variants,
        images,
        brickeconomyData,
        catalogImageUrl,
        includeCatalogImg,
        fieldOverrides,
        ebayCategoryId: (rawProduct.ebay_category_id as string) ?? null,
        ebayMarketplace: (rawProduct.ebay_marketplace as string) ?? null,
        gmcProductCategory: (rawProduct.gmc_product_category as string) ?? null,
        metaCategory: (rawProduct.meta_category as string) ?? null,
        selectedMinifigFigNums,
      };
    },
  });
}

// ─── useUpdateProductCopy ───────────────────────────────────

interface UpdateCopyInput {
  mpn: string;
  hook?: string;
  description?: string;
  highlights?: string;
  cta?: string;
  seoTitle?: string;
  seoDescription?: string;
}

export function useUpdateProductCopy() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: UpdateCopyInput) => {
      const update: Record<string, unknown> = {};
      if (input.hook !== undefined) update.product_hook = input.hook;
      if (input.description !== undefined) update.description = input.description;
      if (input.highlights !== undefined) update.highlights = input.highlights;
      if (input.cta !== undefined) update.call_to_action = input.cta;
      if (input.seoTitle !== undefined) update.seo_title = input.seoTitle;
      if (input.seoDescription !== undefined) update.seo_description = input.seoDescription;

      const { error } = await supabase
        .from('product')
        .update(update as never)
        .eq('mpn', input.mpn);

      if (error) throw error;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: productKeys.detail(variables.mpn) });
      queryClient.invalidateQueries({ queryKey: productKeys.all });
    },
  });
}

// ─── useUpdateConditionNotes ────────────────────────────────

interface UpdateConditionNotesInput {
  skuCode: string;
  conditionNotes: string;
}

export function useUpdateConditionNotes() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ skuCode, conditionNotes }: UpdateConditionNotesInput) => {
      const { error } = await supabase
        .from('sku')
        .update({ condition_notes: conditionNotes } as never)
        .eq('sku_code', skuCode);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: productKeys.all });
    },
  });
}

// ─── useUploadProductImage ──────────────────────────────────

interface UploadImageInput {
  mpn: string;
  file: File;
  altText?: string;
}

export function useUploadProductImage() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ mpn, file, altText }: UploadImageInput) => {
      // 1. Upload to Supabase Storage
      const ext = file.name.split('.').pop() ?? 'jpg';
      const path = `products/${mpn}/${Date.now()}.${ext}`;

      const { error: uploadErr } = await supabase.storage
        .from('media')
        .upload(path, file, { contentType: file.type });

      if (uploadErr) throw uploadErr;

      // 2. Get public URL
      const { data: urlData } = supabase.storage
        .from('media')
        .getPublicUrl(path);

      // 3. Create media_asset record
      const { data: asset, error: assetErr } = await supabase
        .from('media_asset')
        .insert({
          original_url: urlData.publicUrl,
          alt_text: altText ?? null,
          mime_type: file.type,
          file_size_bytes: file.size,
          provenance: 'admin_upload',
        })
        .select()
        .single();

      if (assetErr) throw assetErr;

      // 4. Look up product id
      const { data: product, error: prodErr } = await supabase
        .from('product')
        .select('id')
        .eq('mpn', mpn)
        .single();

      if (prodErr) throw prodErr;

      // 5. Get current max sort_order
      const { data: existing } = await supabase
        .from('product_media')
        .select('sort_order')
        .eq('product_id', product.id)
        .order('sort_order', { ascending: false })
        .limit(1);

      const nextSort = existing && existing.length > 0
        ? (existing[0].sort_order ?? 0) + 1
        : 0;

      // 6. Create product_media record
      const { error: mediaErr } = await supabase
        .from('product_media')
        .insert({
          product_id: product.id,
          media_asset_id: asset.id,
          sort_order: nextSort,
          is_primary: nextSort === 0,
        });

      if (mediaErr) throw mediaErr;

      return { path, url: urlData.publicUrl };
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: productKeys.detail(variables.mpn) });
    },
  });
}

// ─── useUpdateSKUPrice ──────────────────────────────────────

interface UpdatePriceInput {
  skuId: string;
  mpn: string;
  price: number;
  floorPrice: number | null;
}

export function useUpdateSKUPrice() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ skuId, price, floorPrice }: UpdatePriceInput) => {
      if (floorPrice != null && price < floorPrice) {
        throw new Error(
          `Price £${price.toFixed(2)} is below floor £${floorPrice.toFixed(2)}`,
        );
      }

      const { error } = await supabase
        .from('sku')
        .update({
          price,
          v2_markdown_applied: null,
        } as never)
        .eq('id', skuId);

      if (error) throw error;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: productKeys.detail(variables.mpn) });
      queryClient.invalidateQueries({ queryKey: productKeys.all });
    },
  });
}
