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
  ConditionGrade,
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
    salePrice: (row.price as number) ?? null,
    floorPrice: (row.floor_price as number) ?? null,
    avgCost: (row.avg_cost as number) ?? null,
    costRange: (row.cost_range as string) ?? null,
    qtyOnHand: (row.qty_on_hand as number) ?? 0,
    conditionNotes: (row.condition_notes as string) ?? null,
    marketPrice: (row.market_price as number) ?? null,
    createdAt: row.created_at as string,
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

      // Build a lookup of variants per product MPN
      const variantsByMpn = new Map<string, ProductVariant[]>();
      for (const row of ((variantRows ?? []) as Record<string, unknown>[])) {
        const mpn = row.mpn as string;
        const list = variantsByMpn.get(mpn) ?? [];
        list.push(mapVariant(row));
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
          entry = { purchased: 0, unlisted: 0, unsold: 0, sold: 0 };
          counts.set(mpn, entry);
        }

        entry.purchased += 1;
        if (status === 'graded') entry.unlisted += 1;
        else if (status === 'listed') entry.unsold += 1;
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

      const variants: ProductVariant[] = ((skuRows ?? []) as Record<string, unknown>[]).map((row) => {
        const code = row.sku_code as string;
        const summary = summaryByCode.get(code);
        return {
          ...mapVariant({ ...row, mpn: mpn! }),
          qtyOnHand: summary ? (summary.qty_on_hand as number) ?? 0 : 0,
          avgCost: summary ? (summary.avg_cost as number) ?? null : (row.avg_cost as number) ?? null,
          floorPrice: summary ? (summary.floor_price as number) ?? null : (row.floor_price as number) ?? null,
        };
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

      return { ...product, variants, images };
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
