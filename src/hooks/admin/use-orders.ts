// ============================================================
// Admin V2 — Order Hooks
// Covers: useOrders, useOrder, useAllocateOrderItems
// ============================================================

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type {
  Order,
  OrderLineItem,
  OrderDetail,
  OrderStatus,
  Channel,
  QBOSyncStatus,
} from '@/lib/types/admin';
import { calculateVAT } from '@/lib/utils/vat';
import { stockUnitKeys } from './use-stock-units';

// ─── Query Keys ─────────────────────────────────────────────

export const orderKeys = {
  all: ['v2', 'orders'] as const,
  detail: (orderId: string) => ['v2', 'orders', orderId] as const,
};

// ─── Row → Interface Mappers ────────────────────────────────

function mapLegacyStatus(status: string | null): OrderStatus {
  if (!status) return 'new';
  if (status === 'complete' || status === 'paid' || status === 'delivered') return 'complete';
  if (status === 'shipped') return 'shipped';
  if (status === 'refunded') return 'refunded';
  return 'new';
}

function mapOrder(row: Record<string, unknown>): Order {
  const gross = (row.gross_total as number) ?? 0;
  const vat = calculateVAT(gross);

  return {
    id: row.id as string,
    orderNumber: row.order_number as string,
    customerId: (row.customer_id as string) ?? null,
    channel: mapChannel(row.origin_channel as string),
    status: (row.v2_status as OrderStatus) ?? mapLegacyStatus(row.status as string),
    total: gross,
    vatAmount: (row.tax_total as number) ?? vat.vat,
    netAmount: (row.net_amount as number) ?? vat.net,
    paymentMethod: (row.payment_method as string) ?? null,
    carrier: (row.shipped_via as string) ?? null,
    trackingNumber: (row.tracking_number as string) ?? null,
    shippingCost: (row.shipping_total as number) ?? null,
    blueBellClub: (row.blue_bell_club as boolean) ?? false,
    docNumber: (row.doc_number as string) ?? null,
    qboSalesReceiptId: (row.qbo_sales_receipt_id as string) ?? null,
    qboSyncStatus: (row.qbo_sync_status as QBOSyncStatus) ?? 'pending',
    externalOrderId: (row.origin_reference as string) ?? null,
    notes: (row.notes as string) ?? null,
    orderDate: (row.txn_date as string) ?? (row.created_at as string),
    paymentReference: (row.payment_reference as string) ?? null,
    createdAt: row.created_at as string,
    shippedAt: (row.shipped_date as string) ?? null,
    deliveredAt: (row.delivered_at as string) ?? null,
  };
}

function mapChannel(ch: string | null): Channel {
  if (!ch) return 'website';
  const lower = ch.toLowerCase();
  if (lower === 'ebay') return 'ebay';
  if (lower === 'bricklink') return 'bricklink';
  if (lower === 'brickowl') return 'brickowl';
  if (lower === 'in_person' || lower === 'in-person') return 'in_person';
  return 'website';
}

function mapLineItem(row: Record<string, unknown>): OrderLineItem {
  const sku = row.sku as Record<string, unknown> | null;
  const vatRateRow = row.vat_rate as Record<string, unknown> | null;
  const ratePct = vatRateRow ? ((vatRateRow.rate_percent as number) ?? 20) : 20;
  const unitPrice = (row.unit_price as number) ?? 0;
  const net = unitPrice / (1 + ratePct / 100);
  const lineVat = Math.round((unitPrice - net) * 100) / 100;

  return {
    id: row.id as string,
    orderId: row.sales_order_id as string,
    stockUnitId: (row.stock_unit_id as string) ?? null,
    sku: sku ? (sku.sku_code as string) : null,
    name: sku ? ((sku.name as string) ?? null) : null,
    unitPrice,
    cogs: (row.cogs as number) ?? null,
    vatRate: ratePct,
    lineVat,
  };
}

// ─── useOrders ──────────────────────────────────────────────

export function useOrders() {
  return useQuery({
    queryKey: orderKeys.all,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('sales_order')
        .select(`
          *,
          customer:customer_id(id, display_name, email),
          sales_order_line(
            id, sales_order_id, stock_unit_id, unit_price, cogs,
            sku:sku_id(sku_code, name),
            vat_rate:vat_rate_id(rate_percent)
          )
        `)
        .order('created_at', { ascending: false });

      if (error) throw error;

      return ((data ?? []) as Record<string, unknown>[]).map((row) => {
        const order = mapOrder(row);
        const lines = ((row.sales_order_line as Record<string, unknown>[]) ?? []).map(mapLineItem);
        const customerRow = row.customer as Record<string, unknown> | null;
        return {
          ...order,
          lineItems: lines,
          customer: customerRow
            ? {
                id: customerRow.id as string,
                name: (customerRow.display_name as string) ?? '',
                email: (customerRow.email as string) ?? '',
                channelIds: {},
                qboCustomerId: null,
                stripeCustomerId: null,
                blueBellMember: false,
                createdAt: '',
              }
            : null,
        } satisfies OrderDetail;
      });
    },
  });
}

// ─── useOrder ───────────────────────────────────────────────

export function useOrder(orderId: string | undefined) {
  return useQuery({
    queryKey: orderKeys.detail(orderId ?? ''),
    enabled: !!orderId,
    queryFn: async (): Promise<OrderDetail> => {
      const { data, error } = await supabase
        .from('sales_order')
        .select(`
          *,
          customer:customer_id(id, display_name, email),
          sales_order_line(
            id, sales_order_id, stock_unit_id, unit_price, cogs,
            sku:sku_id(sku_code, name),
            vat_rate:vat_rate_id(rate_percent)
          )
        `)
        .eq('id', orderId!)
        .single();

      if (error) throw error;
      const row = data as Record<string, unknown>;
      const order = mapOrder(row);
      const lines = ((row.sales_order_line as Record<string, unknown>[]) ?? []).map(mapLineItem);

      // Fetch stock unit statuses for allocated line items
      const allocatedUnitIds = lines
        .map((li) => li.stockUnitId)
        .filter((id): id is string => !!id);

      if (allocatedUnitIds.length > 0) {
        const { data: unitRows } = await supabase
          .from('stock_unit')
          .select('id, uid, v2_status' as never)
          .in('id', allocatedUnitIds);

        const unitMap = new Map<string, { uid: string | null; status: string }>();
        for (const u of ((unitRows ?? []) as unknown as Record<string, unknown>[])) {
          unitMap.set(u.id as string, {
            uid: (u.uid as string) ?? null,
            status: (u.v2_status as string) ?? 'sold',
          });
        }

        for (const li of lines) {
          if (li.stockUnitId) {
            const unit = unitMap.get(li.stockUnitId);
            if (unit) {
              (li as unknown as Record<string, unknown>)._unitStatus = unit.status;
              (li as unknown as Record<string, unknown>)._unitUid = unit.uid;
            }
          }
        }
      }

      const customerRow = row.customer as Record<string, unknown> | null;

      return {
        ...order,
        lineItems: lines,
        customer: customerRow
          ? {
              id: customerRow.id as string,
              name: (customerRow.display_name as string) ?? '',
              email: (customerRow.email as string) ?? '',
              channelIds: {},
              qboCustomerId: null,
              stripeCustomerId: null,
              blueBellMember: false,
              createdAt: '',
            }
          : null,
      };
    },
  });
}

// ─── useAllocateOrderItems ──────────────────────────────────

interface AllocateInput {
  orderId: string;
  allocations: {
    lineItemId: string;
    skuCode: string;
  }[];
}

export function useAllocateOrderItems() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ orderId, allocations }: AllocateInput) => {
      for (const alloc of allocations) {
        const { error } = await supabase.rpc('allocate_order_line_stock_unit' as never, {
          p_order_id: orderId,
          p_line_item_id: alloc.lineItemId,
          p_sku_code: alloc.skuCode,
        } as never);

        if (error) throw error;
      }
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: orderKeys.detail(variables.orderId) });
      queryClient.invalidateQueries({ queryKey: orderKeys.all });
      queryClient.invalidateQueries({ queryKey: stockUnitKeys.all });
    },
  });
}

// ─── useAllocateOrderLineByUnit ─────────────────────────────
// Allocates a specific stock unit (by UID) to a line. If the unit's SKU
// differs from the line's SKU (e.g. different grade), the line is
// re-pointed to the unit's SKU server-side. Same-MPN safety is enforced
// in the RPC.

interface AllocateByUidInput {
  orderId: string;
  lineItemId: string;
  unitUid: string;
}

export function useAllocateOrderLineByUnit() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ orderId, lineItemId, unitUid }: AllocateByUidInput) => {
      const { error } = await supabase.rpc(
        'allocate_order_line_stock_unit_by_uid' as never,
        {
          p_order_id: orderId,
          p_line_item_id: lineItemId,
          p_unit_uid: unitUid,
        } as never,
      );
      if (error) throw error;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: orderKeys.detail(variables.orderId) });
      queryClient.invalidateQueries({ queryKey: orderKeys.all });
      queryClient.invalidateQueries({ queryKey: stockUnitKeys.all });
    },
  });
}

// ─── useCandidateUnitsForLine ───────────────────────────────
// Returns all available stock units sharing the same MPN as the given
// line, regardless of grade. Used by the allocation dialog to let staff
// pick a specific unit when no exact-grade match exists.

export interface CandidateUnit {
  id: string;
  uid: string | null;
  skuCode: string | null;
  mpn: string;
  conditionGrade: number | null;
  v2Status: string | null;
  batchId: string | null;
  landedCost: number | null;
  exactSkuMatch: boolean;
}

export function useCandidateUnitsForLine(lineSkuId: string | null) {
  return useQuery({
    queryKey: ['v2', 'allocation-candidates', lineSkuId],
    enabled: !!lineSkuId,
    queryFn: async (): Promise<CandidateUnit[]> => {
      // Look up the line's SKU to get the target MPN
      const { data: skuRow, error: skuErr } = await supabase
        .from('sku')
        .select('id, mpn')
        .eq('id', lineSkuId!)
        .single();
      if (skuErr) throw skuErr;
      const targetMpn = (skuRow as { mpn: string }).mpn;

      const { data: units, error: uErr } = await supabase
        .from('stock_unit')
        .select('id, uid, mpn, condition_grade, v2_status, batch_id, landed_cost, sku_id, status')
        .eq('mpn', targetMpn)
        .is('order_id', null)
        .in('v2_status' as never, ['listed', 'graded', 'restocked']);
      if (uErr) throw uErr;

      const unitRows = ((units ?? []) as unknown) as Array<{
        id: string;
        uid: string | null;
        mpn: string;
        condition_grade: string | number | null;
        v2_status: string | null;
        batch_id: string | null;
        landed_cost: number | string | null;
        sku_id: string | null;
      }>;

      // Resolve sku_codes for the unique sku ids
      const skuIds = [...new Set(unitRows.map((u) => u.sku_id).filter(Boolean) as string[])];
      const skuMap = new Map<string, string>();
      if (skuIds.length > 0) {
        const { data: skuRows } = await supabase
          .from('sku')
          .select('id, sku_code')
          .in('id', skuIds);
        for (const r of (skuRows ?? []) as Array<{ id: string; sku_code: string }>) {
          skuMap.set(r.id, r.sku_code);
        }
      }

      return unitRows.map((u) => ({
        id: u.id,
        uid: u.uid,
        skuCode: u.sku_id ? skuMap.get(u.sku_id) ?? null : null,
        mpn: u.mpn,
        conditionGrade: u.condition_grade,
        v2Status: u.v2_status,
        batchId: u.batch_id,
        landedCost: u.landed_cost == null ? null : Number(u.landed_cost),
        exactSkuMatch: u.sku_id === lineSkuId,
      }));
    },
  });
}
