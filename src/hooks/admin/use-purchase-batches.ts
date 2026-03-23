// ============================================================
// Admin V2 — Purchase Batch Hooks
// Covers: usePurchaseBatches, usePurchaseBatch, useCreatePurchaseBatch
// ============================================================

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type {
  PurchaseBatch,
  PurchaseLineItem,
  StockUnit,
  PurchaseBatchDetail,
  SharedCosts,
  StockUnitStatus,
  ConditionGradeAll,
  ConditionFlag,
} from '@/lib/types/admin';

// ─── Query Keys ─────────────────────────────────────────────

export const purchaseBatchKeys = {
  all: ['v2', 'purchase-batches'] as const,
  detail: (batchId: string) => ['v2', 'purchase-batches', batchId] as const,
};

// ─── Row → Interface Mappers ────────────────────────────────

function mapBatch(row: Record<string, unknown>): PurchaseBatch {
  return {
    id: row.id as string,
    supplierName: row.supplier_name as string,
    purchaseDate: row.purchase_date as string,
    reference: (row.reference as string) ?? null,
    supplierVatRegistered: row.supplier_vat_registered as boolean,
    sharedCosts: (row.shared_costs as SharedCosts) ?? { shipping: 0, broker_fee: 0, other: 0, other_label: '' },
    totalSharedCosts: row.total_shared_costs as number,
    status: row.status as PurchaseBatch['status'],
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

function mapLineItem(row: Record<string, unknown>): PurchaseLineItem {
  return {
    id: row.id as string,
    batchId: row.batch_id as string,
    mpn: row.mpn as string,
    quantity: row.quantity as number,
    unitCost: row.unit_cost as number,
    apportionedCost: row.apportioned_cost as number,
    landedCostPerUnit: row.landed_cost_per_unit as number,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

function mapStockUnit(row: Record<string, unknown>): StockUnit {
  return {
    id: row.id as string,
    uid: (row.uid as string) ?? null,
    batchId: (row.batch_id as string) ?? null,
    lineItemId: (row.line_item_id as string) ?? null,
    mpn: row.mpn as string,
    grade: (row.condition_grade as ConditionGradeAll) ?? null,
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

// ─── usePurchaseBatches ─────────────────────────────────────

export function usePurchaseBatches() {
  return useQuery({
    queryKey: purchaseBatchKeys.all,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('purchase_batches' as never)
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;
      return ((data ?? []) as Record<string, unknown>[]).map(mapBatch);
    },
  });
}

// ─── useBatchUnitSummaries ───────────────────────────────────

export interface BatchUnitSummary {
  batchId: string;
  totalUnits: number;
  mpnCount: number;
  ungradedCount: number;
  statusCounts: Record<string, number>;
}

export function useBatchUnitSummaries() {
  return useQuery({
    queryKey: ['v2', 'batch-unit-summaries'] as const,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('stock_unit')
        .select('batch_id, mpn, v2_status, condition_grade')
        .not('batch_id', 'is', null);

      if (error) throw error;

      const summaryMap = new Map<string, BatchUnitSummary>();

      for (const row of ((data ?? []) as Record<string, unknown>[])) {
        const batchId = row.batch_id as string;
        if (!batchId) continue;

        let summary = summaryMap.get(batchId);
        if (!summary) {
          summary = { batchId, totalUnits: 0, mpnCount: 0, ungradedCount: 0, statusCounts: {} };
          summaryMap.set(batchId, summary);
        }

        summary.totalUnits += 1;
        const status = (row.v2_status as string) ?? 'purchased';
        summary.statusCounts[status] = (summary.statusCounts[status] ?? 0) + 1;

        if (row.condition_grade == null) {
          summary.ungradedCount += 1;
        }
      }

      // Count distinct MPNs per batch
      const mpnSets = new Map<string, Set<string>>();
      for (const row of ((data ?? []) as Record<string, unknown>[])) {
        const batchId = row.batch_id as string;
        const mpn = row.mpn as string;
        if (!batchId || !mpn) continue;
        const set = mpnSets.get(batchId) ?? new Set();
        set.add(mpn);
        mpnSets.set(batchId, set);
      }
      for (const [batchId, mpnSet] of mpnSets) {
        const summary = summaryMap.get(batchId);
        if (summary) summary.mpnCount = mpnSet.size;
      }

      return summaryMap;
    },
  });
}

// ─── usePurchaseBatch ───────────────────────────────────────

export function usePurchaseBatch(batchId: string | undefined) {
  return useQuery({
    queryKey: purchaseBatchKeys.detail(batchId ?? ''),
    enabled: !!batchId,
    queryFn: async (): Promise<PurchaseBatchDetail> => {
      // Fetch batch
      const { data: batchRow, error: batchErr } = await supabase
        .from('purchase_batches' as never)
        .select('*')
        .eq('id', batchId!)
        .single();

      if (batchErr) throw batchErr;
      const batch = mapBatch(batchRow as Record<string, unknown>);

      // Fetch line items
      const { data: lineRows, error: lineErr } = await supabase
        .from('purchase_line_items' as never)
        .select('*')
        .eq('batch_id', batchId!)
        .order('created_at', { ascending: true });

      if (lineErr) throw lineErr;
      const lineItems = ((lineRows ?? []) as Record<string, unknown>[]).map(mapLineItem);

      // Fetch stock units for this batch
      const { data: unitRows, error: unitErr } = await supabase
        .from('stock_unit')
        .select('*')
        .eq('batch_id' as never, batchId!);

      if (unitErr) throw unitErr;
      const units = ((unitRows ?? []) as Record<string, unknown>[]).map(mapStockUnit);

      // Group units by line_item_id
      const unitsByLine = new Map<string, StockUnit[]>();
      for (const unit of units) {
        if (unit.lineItemId) {
          const list = unitsByLine.get(unit.lineItemId) ?? [];
          list.push(unit);
          unitsByLine.set(unit.lineItemId, list);
        }
      }

      return {
        ...batch,
        lineItems: lineItems.map((li) => ({
          ...li,
          units: unitsByLine.get(li.id) ?? [],
        })),
      };
    },
  });
}

// ─── useCreatePurchaseBatch ─────────────────────────────────

interface CreateBatchInput {
  supplierName: string;
  purchaseDate: string;
  reference?: string;
  supplierVatRegistered: boolean;
  sharedCosts: SharedCosts;
  lineItems: {
    mpn: string;
    quantity: number;
    unitCost: number;
  }[];
}

export function useCreatePurchaseBatch() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: CreateBatchInput) => {
      const totalShared =
        input.sharedCosts.shipping +
        input.sharedCosts.broker_fee +
        input.sharedCosts.other;

      // 1. Create batch
      const { data: batch, error: batchErr } = await supabase
        .from('purchase_batches' as never)
        .insert({
          supplier_name: input.supplierName,
          purchase_date: input.purchaseDate,
          reference: input.reference ?? null,
          supplier_vat_registered: input.supplierVatRegistered,
          shared_costs: input.sharedCosts,
          total_shared_costs: totalShared,
          status: 'draft',
        } as never)
        .select()
        .single();

      if (batchErr) throw batchErr;
      const batchId = (batch as Record<string, unknown>).id as string;

      // 2. Create line items
      const lineItemInserts = input.lineItems.map((li) => ({
        batch_id: batchId,
        mpn: li.mpn,
        quantity: li.quantity,
        unit_cost: li.unitCost,
      }));

      const { data: lineItems, error: lineErr } = await supabase
        .from('purchase_line_items' as never)
        .insert(lineItemInserts as never)
        .select();

      if (lineErr) throw lineErr;

      // 2b. Auto-create product records for new MPNs (lazy creation per spec)
      const uniqueMpns = [...new Set(input.lineItems.map((li) => li.mpn))];
      for (const mpn of uniqueMpns) {
        const { data: existingProduct } = await supabase
          .from('product')
          .select('id')
          .eq('mpn', mpn)
          .maybeSingle();

        if (!existingProduct) {
          // Create minimal product record — will be enriched asynchronously
          const { error: productErr } = await supabase
            .from('product')
            .insert({
              mpn,
              name: mpn, // Placeholder — enrichment will update with real name
              set_number: mpn.split('-')[0],
            } as never);

          if (productErr) {
            console.warn(`Failed to auto-create product for ${mpn}:`, productErr.message);
          } else {
            // Fire-and-forget: trigger product data enrichment from external APIs
            supabase.functions
              .invoke('rebrickable-sync', { body: { mpn } })
              .catch((err) => console.warn(`Product enrichment for ${mpn} failed (non-blocking):`, err));
          }
        }
      }

      // 3. Create stock units (one per quantity per line item)
      const stockUnitInserts: Record<string, unknown>[] = [];
      for (const li of (lineItems ?? []) as Record<string, unknown>[]) {
        const qty = li.quantity as number;
        for (let i = 0; i < qty; i++) {
          stockUnitInserts.push({
            mpn: li.mpn,
            batch_id: batchId,
            line_item_id: li.id,
            v2_status: 'purchased',
            status: 'pending_receipt', // v1 compat
          });
        }
      }

      if (stockUnitInserts.length > 0) {
        const { error: unitErr } = await supabase
          .from('stock_unit')
          .insert(stockUnitInserts as never);

        if (unitErr) throw unitErr;
      }

      // 4. Run cost apportionment
      const { error: apportionErr } = await supabase
        .rpc('v2_calculate_apportioned_costs', { p_batch_id: batchId } as never);

      if (apportionErr) throw apportionErr;

      return batchId;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: purchaseBatchKeys.all });
    },
  });
}
