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

async function postQboItemViaIntent(input: {
  skuCode: string;
  purchaseCost?: number;
  supplierVatRegistered?: boolean;
}): Promise<{ success: true } | { success: false; error: string }> {
  const { data: sku, error: skuErr } = await supabase
    .from('sku')
    .select('id')
    .eq('sku_code', input.skuCode)
    .maybeSingle();

  if (skuErr) return { success: false, error: skuErr.message };
  const skuId = (sku as Record<string, unknown> | null)?.id as string | null;
  if (!skuId) return { success: false, error: `SKU not found: ${input.skuCode}` };

  const { data: intentId, error: queueErr } = await supabase.rpc(
    'queue_qbo_item_posting_intent' as never,
    {
      p_sku_id: skuId,
      p_purchase_cost: input.purchaseCost ?? null,
      p_supplier_vat_registered: input.supplierVatRegistered ?? null,
    } as never,
  );
  if (queueErr) return { success: false, error: queueErr.message };

  const { data, error } = await supabase.functions.invoke('accounting-posting-intents-process', {
    body: intentId ? { intentId } : { batch_size: 5 },
  });
  if (error) return { success: false, error: error.message };

  const payload = data as Record<string, unknown> | null;
  const results = Array.isArray(payload?.results) ? payload.results as Record<string, unknown>[] : [];
  const result = results.find((row) => row.intent_id === intentId) ?? results[0];
  if (!payload?.success || !result || result.status !== 'posted') {
    return {
      success: false,
      error: String(result?.error ?? payload?.error ?? 'QBO Item posting intent did not complete'),
    };
  }

  return { success: true };
}

async function postQboPurchaseViaIntent(
  batchId: string,
  action: 'create_purchase' | 'update_purchase' | 'delete_purchase',
): Promise<Record<string, unknown>> {
  const { data: intentId, error: queueErr } = await supabase.rpc(
    'queue_qbo_purchase_posting_intent' as never,
    {
      p_batch_id: batchId,
      p_action: action,
    } as never,
  );
  if (queueErr) throw new Error(queueErr.message);

  if (!intentId && action === 'create_purchase') {
    return { success: true, batch_id: batchId, already_synced: true };
  }

  const { data, error } = await supabase.functions.invoke('accounting-posting-intents-process', {
    body: intentId ? { intentId } : { batch_size: 5 },
  });
  if (error) {
    const ctx = (error as { context?: Response }).context;
    let detail = error.message;
    if (ctx && typeof ctx.json === 'function') {
      try {
        const payload = await ctx.json();
        if (payload?.error) detail = String(payload.error);
      } catch (_) { /* fall through */ }
    }
    throw new Error(detail);
  }

  const payload = data as Record<string, unknown> | null;
  const results = Array.isArray(payload?.results) ? payload.results as Record<string, unknown>[] : [];
  const result = results.find((row) => row.intent_id === intentId) ?? results[0];
  if (!payload?.success || !result || result.status !== 'posted') {
    throw new Error(String(result?.error ?? payload?.error ?? 'QBO Purchase posting intent did not complete'));
  }

  return (result.response_payload as Record<string, unknown> | undefined) ?? result;
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

      // Fire-and-forget: queue the batch QBO push. Failures are recorded on the
      // batch row (qbo_sync_status='error') so the operator can retry from
      // the BatchDetail page.
      postQboPurchaseViaIntent(batchId, 'create_purchase')
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
      return postQboPurchaseViaIntent(batchId, 'create_purchase') as Promise<{
        success: boolean;
        batch_id: string;
        qbo_purchase_id?: string;
      }>;
    },
    onSuccess: (_data, batchId) => {
      queryClient.invalidateQueries({ queryKey: purchaseBatchKeys.all });
      queryClient.invalidateQueries({ queryKey: purchaseBatchKeys.detail(batchId) });
    },
  });
}

// ─── useUpdatePurchaseBatch ─────────────────────────────────

export interface UpdateBatchInput {
  batchId: string;
  supplierName: string;
  purchaseDate: string;
  reference: string | null;
  supplierVatRegistered: boolean;
  sharedCosts: SharedCosts;
}

export interface UpdateBatchResult {
  batch_id: string;
  qbo_pushed: boolean;
  qbo_error?: string;
}

export function useUpdatePurchaseBatch() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: UpdateBatchInput): Promise<UpdateBatchResult> => {
      // 1. Update the batch row. The DB trigger re-resolves supplier_id from
      // supplier_name. total_shared_costs is recomputed from the new breakdown.
      const total =
        (input.sharedCosts.shipping || 0) +
        (input.sharedCosts.broker_fee || 0) +
        (input.sharedCosts.other || 0);

      const { data: existing, error: loadErr } = await supabase
        .from('purchase_batches' as never)
        .select('qbo_purchase_id')
        .eq('id', input.batchId)
        .single();
      if (loadErr) throw new Error(`Load batch failed: ${loadErr.message}`);
      const qboPurchaseId = (existing as Record<string, unknown> | null)?.qbo_purchase_id as string | null;

      const { error: updErr } = await supabase
        .from('purchase_batches' as never)
        .update({
          supplier_name: input.supplierName,
          purchase_date: input.purchaseDate,
          reference: input.reference,
          supplier_vat_registered: input.supplierVatRegistered,
          shared_costs: input.sharedCosts as never,
          total_shared_costs: total,
        } as never)
        .eq('id', input.batchId);
      if (updErr) throw new Error(`Update batch failed: ${updErr.message}`);

      // 2. Re-apportion landed costs across the existing line items / units.
      const { error: rpcErr } = await supabase.rpc(
        'v2_calculate_apportioned_costs' as never,
        { p_batch_id: input.batchId } as never,
      );
      if (rpcErr) {
        console.warn(`Re-apportion failed for ${input.batchId}: ${rpcErr.message}`);
      }

      // 3. If already in QBO, push the update.
      if (qboPurchaseId) {
        try {
          const data = await postQboPurchaseViaIntent(input.batchId, 'update_purchase');
          if (data && typeof data === 'object' && 'error' in data) {
            return {
              batch_id: input.batchId,
              qbo_pushed: false,
              qbo_error: String((data as { error: unknown }).error),
            };
          }
          return { batch_id: input.batchId, qbo_pushed: true };
        } catch (err) {
          return {
            batch_id: input.batchId,
            qbo_pushed: false,
            qbo_error: err instanceof Error ? err.message : String(err),
          };
        }
      }

      return { batch_id: input.batchId, qbo_pushed: false };
    },
    onSuccess: (_data, input) => {
      queryClient.invalidateQueries({ queryKey: purchaseBatchKeys.all });
      queryClient.invalidateQueries({ queryKey: purchaseBatchKeys.detail(input.batchId) });
    },
  });
}

// ─── useUpdatePurchaseLineItem ──────────────────────────────

export interface UpdatePurchaseLineItemInput {
  batchId: string;
  lineItemId: string;
  mpn: string; // unchanged — used to locate product + grade-5 SKU
  name: string | null; // null/empty → reset to mpn
  unitCost: number;
}

export interface UpdatePurchaseLineItemResult {
  line_item_id: string;
  qbo_pushed: boolean;
  qbo_error?: string;
}

export function useUpdatePurchaseLineItem() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: UpdatePurchaseLineItemInput): Promise<UpdatePurchaseLineItemResult> => {
      // 1. Load batch to know whether it's already in QBO
      const { data: batchRow, error: batchErr } = await supabase
        .from('purchase_batches' as never)
        .select('qbo_purchase_id')
        .eq('id', input.batchId)
        .single();
      if (batchErr) throw new Error(`Load batch failed: ${batchErr.message}`);
      const qboPurchaseId = (batchRow as Record<string, unknown> | null)?.qbo_purchase_id as string | null;

      // 2. Update the line item itself (unit_cost). Quantity/MPN stay locked.
      const { error: liErr } = await supabase
        .from('purchase_line_items' as never)
        .update({ unit_cost: input.unitCost } as never)
        .eq('id', input.lineItemId);
      if (liErr) throw new Error(`Update line item failed: ${liErr.message}`);

      // 3. Update product.name on the canonical product row keyed by MPN.
      // The QBO Item name is derived from product.name in qbo-sync-item.
      const newName = input.name?.trim() || input.mpn;
      const { error: prodErr } = await supabase
        .from('product')
        .update({ name: newName } as never)
        .eq('mpn', input.mpn);
      if (prodErr) throw new Error(`Update product failed: ${prodErr.message}`);

      // 4. Re-apportion landed costs across the batch's line items / units.
      const { error: rpcErr } = await supabase.rpc(
        'v2_calculate_apportioned_costs' as never,
        { p_batch_id: input.batchId } as never,
      );
      if (rpcErr) {
        console.warn(`Re-apportion failed for ${input.batchId}: ${rpcErr.message}`);
      }

      // 5. If batch already in QBO, push the QBO Item update (name + cost),
      //    then push the QBO Purchase update (line totals).
      if (qboPurchaseId) {
        const skuCode = `${input.mpn}.5`;
        try {
          const itemResult = await postQboItemViaIntent({
            skuCode,
            purchaseCost: input.unitCost,
            supplierVatRegistered: false,
          });
          if (itemResult.success === false) {
            return {
              line_item_id: input.lineItemId,
              qbo_pushed: false,
              qbo_error: `QBO Item sync: ${itemResult.error}`,
            };
          }
        } catch (e) {
          return {
            line_item_id: input.lineItemId,
            qbo_pushed: false,
            qbo_error: `QBO Item sync threw: ${e instanceof Error ? e.message : String(e)}`,
          };
        }

        try {
          const data = await postQboPurchaseViaIntent(input.batchId, 'update_purchase');
          if (data && typeof data === 'object' && 'error' in data) {
            return {
              line_item_id: input.lineItemId,
              qbo_pushed: false,
              qbo_error: String((data as { error: unknown }).error),
            };
          }
          return { line_item_id: input.lineItemId, qbo_pushed: true };
        } catch (err) {
          return {
            line_item_id: input.lineItemId,
            qbo_pushed: false,
            qbo_error: err instanceof Error ? err.message : String(err),
          };
        }
      }

      return { line_item_id: input.lineItemId, qbo_pushed: false };
    },
    onSuccess: (_data, input) => {
      queryClient.invalidateQueries({ queryKey: purchaseBatchKeys.all });
      queryClient.invalidateQueries({ queryKey: purchaseBatchKeys.detail(input.batchId) });
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
      if (!input.skipQbo) {
        const data = await postQboPurchaseViaIntent(input.batchId, 'delete_purchase');
        if (data && typeof data === 'object' && 'error' in data) {
          throw new Error(String((data as { error: unknown }).error));
        }
        return data as unknown as DeletePurchaseBatchResult;
      }

      const { data, error } = await supabase.functions.invoke('v2-delete-purchase-batch', {
        body: { batch_id: input.batchId, skip_qbo: true },
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
