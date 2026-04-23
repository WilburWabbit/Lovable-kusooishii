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
  const lineItems = (row.purchase_line_items as { unit_cost: number; quantity: number }[] | undefined) ?? [];
  const totalUnitCosts = lineItems.reduce((sum, li) => sum + (li.unit_cost ?? 0) * (li.quantity ?? 0), 0);
  return {
    id: row.id as string,
    supplierId: (row.supplier_id as string) ?? null,
    supplierName: row.supplier_name as string,
    purchaseDate: row.purchase_date as string,
    reference: (row.reference as string) ?? null,
    supplierVatRegistered: row.supplier_vat_registered as boolean,
    sharedCosts: (row.shared_costs as SharedCosts) ?? { shipping: 0, broker_fee: 0, other: 0, other_label: '' },
    totalSharedCosts: (row.total_shared_costs as number) ?? 0,
    totalUnitCosts,
    status: row.status as PurchaseBatch['status'],
    qboPurchaseId: (row.qbo_purchase_id as string) ?? null,
    qboSyncStatus: (row.qbo_sync_status as PurchaseBatch['qboSyncStatus']) ?? 'pending',
    qboSyncError: (row.qbo_sync_error as string) ?? null,
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
    notes: (row.notes as string) ?? null,
  };
}

// ─── usePurchaseBatches ─────────────────────────────────────

export function usePurchaseBatches() {
  return useQuery({
    queryKey: purchaseBatchKeys.all,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('purchase_batches' as never)
        .select('*, purchase_line_items(unit_cost, quantity)' as never)
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
        .select('batch_id, mpn, v2_status, condition_grade' as never)
        .not('batch_id' as never, 'is', null);

      if (error) throw error;

      const summaryMap = new Map<string, BatchUnitSummary>();

      for (const row of ((data ?? []) as unknown as Record<string, unknown>[])) {
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
      for (const row of ((data ?? []) as unknown as Record<string, unknown>[])) {
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

      // Fetch product data for all MPNs in this batch
      const uniqueMpns = [...new Set(lineItems.map((li) => li.mpn))];
      const productNameMap = new Map<string, string>();
      const productDataMap = new Map<string, Record<string, unknown>>();
      if (uniqueMpns.length > 0) {
        const { data: products } = await supabase
          .from('product')
          .select('*')
          .in('mpn', uniqueMpns);

        for (const p of ((products ?? []) as Record<string, unknown>[])) {
          const mpn = p.mpn as string;
          const name = p.name as string;
          if (mpn) productDataMap.set(mpn, p);
          if (mpn && name && name !== mpn) productNameMap.set(mpn, name);
        }
      }

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
        productDataMap,
        lineItems: lineItems.map((li) => ({
          ...li,
          productName: productNameMap.get(li.mpn) ?? null,
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
    name?: string;
    quantity: number;
    unitCost: number;
  }[];
}

export function useCreatePurchaseBatch() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: CreateBatchInput) => {
      // Single atomic RPC call. The DB function wraps the entire create
      // (header + line items + product/SKU upsert + UID reservation +
      // stock_unit insert + cost apportionment + audit) in one transaction.
      // Any failure → automatic rollback → no orphan batches.
      const payload = {
        supplier_name: input.supplierName,
        purchase_date: input.purchaseDate,
        reference: input.reference ?? null,
        supplier_vat_registered: input.supplierVatRegistered,
        shared_costs: input.sharedCosts,
        line_items: input.lineItems.map((li) => ({
          mpn: li.mpn,
          name: li.name ?? null,
          quantity: li.quantity,
          unit_cost: li.unitCost,
        })),
      };

      const { data, error } = await supabase.rpc(
        'v2_create_purchase_batch' as never,
        { p_input: payload } as never,
      );

      if (error) {
        // Surface PostgrestError details for the form's error banner.
        const parts = [error.message];
        if ((error as { details?: string }).details) parts.push((error as { details: string }).details);
        if ((error as { hint?: string }).hint) parts.push(`Hint: ${(error as { hint: string }).hint}`);
        throw new Error(parts.join(' — '));
      }

      const result = data as { batch_id: string } | null;
      const batchId = result?.batch_id;
      if (!batchId) throw new Error('Purchase batch created but server returned no batch_id');

      // Fire-and-forget: enrich each new MPN from external catalog APIs.
      // Non-blocking — failures don't affect batch creation.
      const uniqueMpns = [...new Set(input.lineItems.map((li) => li.mpn))];
      for (const mpn of uniqueMpns) {
        supabase.functions
          .invoke('rebrickable-sync', { body: { mpn } })
          .catch((err) => console.warn(`Product enrichment for ${mpn} failed (non-blocking):`, err));
      }

      // Fire-and-forget: push the batch to QBO. Failures are recorded on the
      // batch row (qbo_sync_status='error') so the operator can retry from
      // the BatchDetail page.
      supabase.functions
        .invoke('v2-push-purchase-to-qbo', { body: { batch_id: batchId } })
        .catch((err) => console.warn(`QBO push for ${batchId} failed (non-blocking):`, err));

      return batchId;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: purchaseBatchKeys.all });
    },
  });
}

// ─── usePushPurchaseToQbo ───────────────────────────────────

export function usePushPurchaseToQbo() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (batchId: string) => {
      const { data, error } = await supabase.functions.invoke('v2-push-purchase-to-qbo', {
        body: { batch_id: batchId },
      });
      if (error) {
        const ctx = (error as { context?: Response }).context;
        if (ctx && typeof ctx.json === 'function') {
          try {
            const payload = await ctx.json();
            if (payload?.error) throw new Error(payload.error);
          } catch (_) { /* fall through */ }
        }
        throw new Error(error.message);
      }
      if (data && typeof data === 'object' && 'error' in data) {
        throw new Error(String((data as { error: unknown }).error));
      }
      return data as { success: boolean; batch_id: string; qbo_purchase_id?: string };
    },
    onSuccess: (_data, batchId) => {
      queryClient.invalidateQueries({ queryKey: purchaseBatchKeys.all });
      queryClient.invalidateQueries({ queryKey: purchaseBatchKeys.detail(batchId) });
    },
  });
}

// ─── useDeletePurchaseBatch ─────────────────────────────────

export interface DeletePurchaseBatchResult {
  success: boolean;
  batch_id: string;
  units_deleted: number;
  qbo_purchase_id: string | null;
  qbo_result: { deleted: boolean; reason?: string } | { skipped: true };
}

export function useDeletePurchaseBatch() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { batchId: string; skipQbo?: boolean }): Promise<DeletePurchaseBatchResult> => {
      const { data, error } = await supabase.functions.invoke('v2-delete-purchase-batch', {
        body: { batch_id: input.batchId, skip_qbo: input.skipQbo ?? false },
      });
      if (error) {
        // FunctionsHttpError carries the response body as `error.context`.
        const ctx = (error as { context?: Response }).context;
        if (ctx && typeof ctx.json === 'function') {
          try {
            const payload = await ctx.json();
            if (payload?.error) throw new Error(payload.error);
          } catch (_) { /* fall through */ }
        }
        throw new Error(error.message);
      }
      if (data && typeof data === 'object' && 'error' in data) {
        throw new Error(String((data as { error: unknown }).error));
      }
      return data as DeletePurchaseBatchResult;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: purchaseBatchKeys.all });
    },
  });
}
