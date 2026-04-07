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

function mapOrder(row: Record<string, unknown>): Order {
  const gross = (row.gross_total as number) ?? 0;
  const vat = calculateVAT(gross);

  return {
    id: row.id as string,
    orderNumber: row.order_number as string,
    customerId: (row.customer_id as string) ?? null,
    channel: mapChannel(row.origin_channel as string),
    status: (row.v2_status as OrderStatus) ?? 'new',
    total: gross,
    vatAmount: (row.tax_total as number) ?? vat.vat,
    netAmount: (row.net_amount as number) ?? vat.net,
    paymentMethod: (row.payment_method as string) ?? null,
    carrier: (row.shipped_via as string) ?? null,
    trackingNumber: (row.tracking_number as string) ?? null,
    shippingCost: (row.shipping_total as number) ?? null,
    blueBellClub: (row.blue_bell_club as boolean) ?? false,
    qboSalesReceiptId: (row.qbo_sales_receipt_id as string) ?? null,
    qboSyncStatus: (row.qbo_sync_status as QBOSyncStatus) ?? 'pending',
    externalOrderId: (row.origin_reference as string) ?? null,
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
  return {
    id: row.id as string,
    orderId: row.sales_order_id as string,
    stockUnitId: (row.stock_unit_id as string) ?? null,
    sku: sku ? (sku.sku_code as string) : null,
    name: sku ? ((sku.name as string) ?? null) : null,
    unitPrice: (row.unit_price as number) ?? 0,
    cogs: (row.cogs as number) ?? null,
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
            sku:sku_id(sku_code, name)
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
            sku:sku_id(sku_code)
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
        // Consume FIFO unit via database function
        const { data: unit, error: fifoErr } = await supabase
          .rpc('v2_consume_fifo_unit' as never, { p_sku_code: alloc.skuCode } as never);

        if (fifoErr) throw fifoErr;
        const consumed = unit as unknown as Record<string, unknown>;

        // Update the order line item with the allocated unit
        const { error: lineErr } = await supabase
          .from('sales_order_line')
          .update({
            stock_unit_id: consumed.id,
            cogs: consumed.landed_cost,
          } as never)
          .eq('id', alloc.lineItemId);

        if (lineErr) throw lineErr;

        // Link stock unit to the order
        const { error: unitErr } = await supabase
          .from('stock_unit')
          .update({
            order_id: orderId,
          } as never)
          .eq('id', consumed.id as string);

        if (unitErr) throw unitErr;
      }

      // Transition order status from needs_allocation → new
      const { error: statusErr } = await supabase
        .from('sales_order')
        .update({ v2_status: 'new' } as never)
        .eq('id', orderId)
        .eq('v2_status' as never, 'needs_allocation');

      if (statusErr) throw statusErr;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: orderKeys.detail(variables.orderId) });
      queryClient.invalidateQueries({ queryKey: orderKeys.all });
      queryClient.invalidateQueries({ queryKey: stockUnitKeys.all });
    },
  });
}
