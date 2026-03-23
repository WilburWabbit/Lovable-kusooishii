// ============================================================
// Admin V2 — Stock Unit Hooks
// Covers: useStockUnit, useStockUnitsByVariant,
//         useGradeStockUnit, useBulkGradeStockUnits
// ============================================================

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type {
  StockUnit,
  StockUnitStatus,
  ConditionGrade,
  ConditionGradeAll,
  ConditionFlag,
} from '@/lib/types/admin';
import { purchaseBatchKeys } from './use-purchase-batches';

// ─── Query Keys ─────────────────────────────────────────────

export const stockUnitKeys = {
  all: ['v2', 'stock-units'] as const,
  detail: (uid: string) => ['v2', 'stock-units', uid] as const,
  byVariant: (sku: string) => ['v2', 'stock-units', 'variant', sku] as const,
};

// ─── Row → Interface Mapper ────────────────────────────────

function mapStockUnit(row: Record<string, unknown>): StockUnit {
  return {
    id: row.id as string,
    uid: (row.uid as string) ?? null,
    batchId: (row.batch_id as string) ?? null,
    lineItemId: (row.line_item_id as string) ?? null,
    mpn: row.mpn as string,
    grade: (row.condition_grade != null ? Number(row.condition_grade) as ConditionGradeAll : null),
    sku: row.condition_grade ? `${row.mpn}.${row.condition_grade}` : null,
    landedCost: (row.landed_cost as number) ?? null,
    conditionFlags: ((row.condition_flags as ConditionFlag[]) ?? []),
    status: (row.v2_status as StockUnitStatus) ?? 'purchased',
    orderId: (row.order_id as string) ?? null,
    payoutId: (row.payout_id as string) ?? null,
    createdAt: row.created_at as string,
    gradedAt: (row.graded_at as string) ?? null,
    listedAt: (row.listed_at as string) ?? null,
    soldAt: (row.sold_at as string) ?? null,
    shippedAt: (row.shipped_at as string) ?? null,
    deliveredAt: (row.delivered_at as string) ?? null,
    completedAt: (row.completed_at as string) ?? null,
  };
}

// ─── useStockUnit ───────────────────────────────────────────

export function useStockUnit(uid: string | undefined) {
  return useQuery({
    queryKey: stockUnitKeys.detail(uid ?? ''),
    enabled: !!uid,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('stock_unit')
        .select('*')
        .eq('uid' as never, uid!)
        .single();

      if (error) throw error;
      return mapStockUnit(data as Record<string, unknown>);
    },
  });
}

// ─── useStockUnitsByVariant ─────────────────────────────────

export function useStockUnitsByVariant(skuCode: string | undefined) {
  return useQuery({
    queryKey: stockUnitKeys.byVariant(skuCode ?? ''),
    enabled: !!skuCode,
    queryFn: async () => {
      // Look up the sku record to get its id
      const { data: skuRow, error: skuErr } = await supabase
        .from('sku')
        .select('id')
        .eq('sku_code', skuCode!)
        .single();

      if (skuErr) throw skuErr;

      const { data, error } = await supabase
        .from('stock_unit')
        .select('*')
        .eq('sku_id', skuRow.id)
        .order('created_at', { ascending: true });

      if (error) throw error;
      return ((data ?? []) as Record<string, unknown>[]).map(mapStockUnit);
    },
  });
}

// ─── useStockUnitsByMPN ───────────────────────────────────────

export function useStockUnitsByMPN(mpn: string | undefined) {
  return useQuery({
    queryKey: ['v2', 'stock-units', 'mpn', mpn ?? ''] as const,
    enabled: !!mpn,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('stock_unit')
        .select('*')
        .eq('mpn' as never, mpn!)
        .order('created_at', { ascending: true });

      if (error) throw error;
      return ((data ?? []) as Record<string, unknown>[]).map(mapStockUnit);
    },
  });
}

// ─── useGradeStockUnit ──────────────────────────────────────

interface GradeInput {
  stockUnitId: string;
  grade: ConditionGrade;
  conditionFlags?: ConditionFlag[];
}

export function useGradeStockUnit() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ stockUnitId, grade, conditionFlags = [] }: GradeInput) => {
      // Look up or create the target SKU for this grade
      const { data: unit, error: fetchErr } = await supabase
        .from('stock_unit')
        .select('mpn, line_item_id, batch_id')
        .eq('id', stockUnitId)
        .single();

      if (fetchErr) throw fetchErr;
      const mpn = (unit as Record<string, unknown>).mpn as string;
      const skuCode = `${mpn}.${grade}`;

      // Fetch market data from BrickEconomy for pricing
      const setNumber = mpn.split('-')[0];
      const { data: beData } = await supabase
        .from('brickeconomy_collection')
        .select('current_value')
        .eq('item_number', setNumber)
        .order('synced_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      const GRADE_RATIOS: Record<number, number> = { 1: 1.0, 2: 0.8, 3: 0.6, 4: 0.4 };
      const baseMarketPrice = (beData as Record<string, unknown> | null)?.current_value as number | null;
      const gradeMarketPrice = baseMarketPrice
        ? Math.round(baseMarketPrice * (GRADE_RATIOS[grade] ?? 0.5) * 100) / 100
        : null;

      // Find or create the SKU
      let skuId: string;
      const { data: existingSku } = await supabase
        .from('sku')
        .select('id, market_price')
        .eq('sku_code', skuCode)
        .maybeSingle();

      if (existingSku) {
        skuId = existingSku.id;

        // Update market_price with latest data (preserve user-set sale_price)
        if (gradeMarketPrice != null) {
          await supabase
            .from('sku')
            .update({ market_price: gradeMarketPrice } as never)
            .eq('id', skuId);
        }
      } else {
        // Look up the product
        const { data: product } = await supabase
          .from('product')
          .select('id')
          .eq('mpn', mpn)
          .single();

        if (!product) throw new Error(`Product not found for MPN ${mpn}`);

        // Create SKU with market_price and initial sale_price from market data
        const skuInsert: Record<string, unknown> = {
          sku_code: skuCode,
          product_id: product.id,
          condition_grade: String(grade),
          active_flag: true,
          saleable_flag: grade <= 4,
          mpn,
        };
        if (gradeMarketPrice != null) {
          skuInsert.market_price = gradeMarketPrice;
          skuInsert.price = gradeMarketPrice; // Initial sale_price = market_price
        }

        const { data: newSku, error: skuErr } = await supabase
          .from('sku')
          .insert(skuInsert as never)
          .select()
          .single();

        if (skuErr) throw skuErr;
        skuId = (newSku as Record<string, unknown>).id as string;
      }

      // Check if this SKU already has live channel listings
      const { data: liveListings } = await supabase
        .from('channel_listing')
        .select('id')
        .eq('sku_id' as never, skuId)
        .eq('v2_status' as never, 'live')
        .limit(1);

      const hasLiveListings = (liveListings ?? []).length > 0;

      // Update the stock unit — auto-promote to 'listed' if SKU already has live listings
      const now = new Date().toISOString();
      const { error: updateErr } = await supabase
        .from('stock_unit')
        .update({
          condition_grade: String(grade),
          sku_id: skuId,
          condition_flags: conditionFlags,
          v2_status: hasLiveListings ? 'listed' : 'graded',
          graded_at: now,
          ...(hasLiveListings ? { listed_at: now } : {}),
        } as never)
        .eq('id', stockUnitId);

      if (updateErr) throw updateErr;

      // Fire-and-forget: sync SKU to QBO (creates or updates the Item)
      supabase.functions
        .invoke('qbo-sync-item', { body: { skuCode } })
        .then((res) => {
          if (res.error) console.warn(`QBO item sync for ${skuCode} failed (non-blocking):`, res.error);
          else console.log(`QBO item sync for ${skuCode}: success`);
        })
        .catch((err) => console.warn(`QBO item sync for ${skuCode} failed (non-blocking):`, err));

      return { stockUnitId, skuCode, autoListed: hasLiveListings };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: stockUnitKeys.all });
      queryClient.invalidateQueries({ queryKey: purchaseBatchKeys.all });
    },
  });
}

// ─── useBulkGradeStockUnits ─────────────────────────────────

interface BulkGradeInput {
  stockUnitIds: string[];
  grade: ConditionGrade;
  conditionFlags?: ConditionFlag[];
}

export function useBulkGradeStockUnits() {
  const gradeUnit = useGradeStockUnit();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ stockUnitIds, grade, conditionFlags = [] }: BulkGradeInput) => {
      // Grade units sequentially to ensure SKU creation happens once
      const results: { stockUnitId: string; skuCode: string }[] = [];
      for (const id of stockUnitIds) {
        const result = await gradeUnit.mutateAsync({
          stockUnitId: id,
          grade,
          conditionFlags,
        });
        results.push(result);
      }
      return results;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: stockUnitKeys.all });
      queryClient.invalidateQueries({ queryKey: purchaseBatchKeys.all });
    },
  });
}
