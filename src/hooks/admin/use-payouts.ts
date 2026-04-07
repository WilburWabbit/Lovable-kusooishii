// ============================================================
// Admin V2 — Payout Hooks
// Covers: usePayouts, usePayoutSummary
// ============================================================

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type {
  Payout,
  PayoutChannel,
  QBOSyncStatus,
  FeeBreakdown,
} from '@/lib/types/admin';

// ─── Query Keys ─────────────────────────────────────────────

export const payoutKeys = {
  all:        ['v2', 'payouts']              as const,
  summary:    ['v2', 'payouts', 'summary']   as const,
  fees:       (payoutId: string)    => ['v2', 'payouts', payoutId, 'fees']    as const,
  orderFees:  (orderId: string)     => ['v2', 'order-fees', orderId]          as const,
  unitProfit: (unitId?: string)     => unitId
    ? ['v2', 'unit-profit', unitId] as const
    : ['v2', 'unit-profit']         as const,
};

// ─── Fee Types ──────────────────────────────────────────────

export type FeeCategory =
  | 'selling_fee'
  | 'shipping_label'
  | 'payment_processing'
  | 'advertising'
  | 'subscription'
  | 'other';

export interface PayoutFee {
  id: string;
  payoutId: string;
  salesOrderId: string | null;
  externalOrderId: string | null;
  vendorId: string | null;
  feeCategory: FeeCategory;
  amount: number;
  channel: string;
  description: string | null;
  createdAt: string;
}

export interface PayoutFeeLine {
  id: string;
  payoutFeeId: string;
  ebayTransactionId: string | null;
  feeType: string;      // raw eBay feeType e.g. FINAL_VALUE_FEE
  feeCategory: FeeCategory;
  amount: number;
  createdAt: string;
}

export interface PayoutFeeWithLines extends PayoutFee {
  lines: PayoutFeeLine[];
}

export interface UnitProfit {
  stockUnitId: string;
  uid: string | null;
  sku: string;
  v2Status: string;
  batchId: string | null;
  payoutId: string | null;
  salesOrderId: string;
  grossRevenue: number;
  landedCost: number;
  sellingFee: number;
  shippingFee: number;
  processingFee: number;
  advertisingFee: number;
  totalFeesPerUnit: number;
  netProfit: number;
  netMarginPct: number | null;
  grossMarginPct: number | null;
  feePct: number | null;
}

// ─── Row → Interface Mapper ────────────────────────────────

function mapPayout(row: Record<string, unknown>): Payout {
  return {
    id: row.id as string,
    channel: row.channel as PayoutChannel,
    payoutDate: row.payout_date as string,
    grossAmount: row.gross_amount as number,
    totalFees: row.total_fees as number,
    netAmount: row.net_amount as number,
    feeBreakdown: (row.fee_breakdown as FeeBreakdown) ?? {},
    orderCount: (row.order_count as number) ?? 0,
    unitCount: (row.unit_count as number) ?? 0,
    qboDepositId: (row.qbo_deposit_id as string) ?? null,
    qboExpenseId: (row.qbo_expense_id as string) ?? null,
    qboSyncStatus: (row.qbo_sync_status as QBOSyncStatus) ?? 'pending',
    externalPayoutId: (row.external_payout_id as string) ?? null,
    reconciliationStatus: (row.reconciliation_status as 'pending' | 'reconciled') ?? 'pending',
    transactionCount: (row.transaction_count as number) ?? 0,
    matchedOrderCount: (row.matched_order_count as number) ?? 0,
    unmatchedTransactionCount: (row.unmatched_transaction_count as number) ?? 0,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

// ─── usePayouts ─────────────────────────────────────────────

export function usePayouts() {
  return useQuery({
    queryKey: payoutKeys.all,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('payouts' as never)
        .select('*')
        .order('payout_date', { ascending: false });

      if (error) throw error;
      return ((data ?? []) as Record<string, unknown>[]).map(mapPayout);
    },
  });
}

// ─── usePayoutSummary ───────────────────────────────────────

export interface PayoutSummary {
  pendingByChannel: Record<PayoutChannel, {
    orderCount: number;
    unitCount: number;
    estimatedGross: number;
  }>;
  blueBellCommission: {
    owedSinceLastPayment: number;
    qualifyingOrderCount: number;
  };
}

export function usePayoutSummary() {
  return useQuery({
    queryKey: payoutKeys.summary,
    queryFn: async (): Promise<PayoutSummary> => {
      // Count stock units in 'delivered' or 'payout_received' status
      // grouped by the order's channel — these represent pending payouts
      const { data: pendingUnits, error: unitErr } = await supabase
        .from('stock_unit')
        .select('id, order_id, landed_cost, v2_status' as never)
        .in('v2_status' as never, ['delivered', 'sold', 'shipped']);

      if (unitErr) throw unitErr;

      // Get the orders for these units to determine channel
      const orderIds = [
        ...new Set(
          ((pendingUnits ?? []) as unknown as Record<string, unknown>[])
            .map((u) => u.order_id as string)
            .filter(Boolean),
        ),
      ];

      const channelSummary: Record<PayoutChannel, { orderCount: number; unitCount: number; estimatedGross: number }> = {
        ebay: { orderCount: 0, unitCount: 0, estimatedGross: 0 },
        stripe: { orderCount: 0, unitCount: 0, estimatedGross: 0 },
      };

      if (orderIds.length > 0) {
        const { data: orders } = await supabase
          .from('sales_order')
          .select('id, origin_channel, gross_total')
          .in('id', orderIds);

        const orderMap = new Map<string, Record<string, unknown>>();
        for (const o of ((orders ?? []) as Record<string, unknown>[])) {
          orderMap.set(o.id as string, o);
        }

        const countedOrders = new Set<string>();
        for (const unit of ((pendingUnits ?? []) as unknown as Record<string, unknown>[])) {
          const orderId = unit.order_id as string;
          if (!orderId) continue;
          const order = orderMap.get(orderId);
          if (!order) continue;

          const ch = (order.origin_channel as string)?.toLowerCase();
          const payoutCh: PayoutChannel = ch === 'ebay' ? 'ebay' : 'stripe';

          channelSummary[payoutCh].unitCount += 1;
          if (!countedOrders.has(orderId)) {
            countedOrders.add(orderId);
            channelSummary[payoutCh].orderCount += 1;
            channelSummary[payoutCh].estimatedGross += (order.gross_total as number) ?? 0;
          }
        }
      }

      // Blue Bell commission: orders with blue_bell_club = true
      // that haven't had their commission paid yet
      const { data: bbOrders, error: bbErr } = await supabase
        .from('sales_order')
        .select('id, gross_total')
        .eq('blue_bell_club' as never, true);

      if (bbErr) throw bbErr;

      const bbTotal = ((bbOrders ?? []) as Record<string, unknown>[])
        .reduce((sum, o) => sum + ((o.gross_total as number) ?? 0), 0);

      return {
        pendingByChannel: channelSummary,
        blueBellCommission: {
          owedSinceLastPayment: Math.round(bbTotal * 0.05 * 100) / 100, // 5% commission per spec Section 3.10
          qualifyingOrderCount: (bbOrders ?? []).length,
        },
      };
    },
  });
}

// ─── useCreatePayout ────────────────────────────────────────

interface CreatePayoutInput {
  channel: PayoutChannel;
  payoutDate: string;
  grossAmount: number;
  totalFees: number;
  netAmount: number;
  feeBreakdown: FeeBreakdown;
  externalPayoutId?: string;
  notes?: string;
}

export function useCreatePayout() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: CreatePayoutInput) => {
      const { data, error } = await supabase
        .from('payouts' as never)
        .insert({
          channel: input.channel,
          payout_date: input.payoutDate,
          gross_amount: input.grossAmount,
          total_fees: input.totalFees,
          net_amount: input.netAmount,
          fee_breakdown: input.feeBreakdown,
          order_count: 0,
          unit_count: 0,
          qbo_sync_status: 'pending',
          external_payout_id: input.externalPayoutId ?? null,
          notes: input.notes ?? null,
        } as never)
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: payoutKeys.all });
      queryClient.invalidateQueries({ queryKey: payoutKeys.summary });
    },
  });
}

// ─── useReconcilePayout ─────────────────────────────────────

export function useReconcilePayout() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (payoutId: string) => {
      const { data, error } = await supabase.functions.invoke('v2-reconcile-payout', {
        body: { payoutId },
      });

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: payoutKeys.all });
      queryClient.invalidateQueries({ queryKey: payoutKeys.summary });
    },
  });
}

// ─── useTriggerPayoutQBOSync ────────────────────────────────

export function useTriggerPayoutQBOSync() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (payoutId: string) => {
      const { data, error } = await supabase.functions.invoke('qbo-sync-payout', {
        body: { payoutId },
      });

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: payoutKeys.all });
    },
  });
}

// ─── useImportEbayPayouts ───────────────────────────────────

export function useImportEbayPayouts() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (params?: { dateFrom?: string; dateTo?: string }) => {
      const { data, error } = await supabase.functions.invoke('ebay-import-payouts', {
        body: params ?? {},
      });

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: payoutKeys.all });
      queryClient.invalidateQueries({ queryKey: payoutKeys.summary });
      // Fee data may have changed — invalidate profit view too
      queryClient.invalidateQueries({ queryKey: payoutKeys.unitProfit() });
    },
  });
}

// ─── usePayoutFees ──────────────────────────────────────────
// All payout_fee rows for a given payout, with their lines.

function mapPayoutFee(row: Record<string, unknown>): PayoutFee {
  return {
    id:              row.id as string,
    payoutId:        row.payout_id as string,
    salesOrderId:    (row.sales_order_id as string) ?? null,
    externalOrderId: (row.external_order_id as string) ?? null,
    vendorId:        (row.vendor_id as string) ?? null,
    feeCategory:     row.fee_category as FeeCategory,
    amount:          row.amount as number,
    channel:         row.channel as string,
    description:     (row.description as string) ?? null,
    createdAt:       row.created_at as string,
  };
}

function mapPayoutFeeLine(row: Record<string, unknown>): PayoutFeeLine {
  return {
    id:                row.id as string,
    payoutFeeId:       row.payout_fee_id as string,
    ebayTransactionId: (row.ebay_transaction_id as string) ?? null,
    feeType:           row.fee_type as string,
    feeCategory:       row.fee_category as FeeCategory,
    amount:            row.amount as number,
    createdAt:         row.created_at as string,
  };
}

export function usePayoutFees(payoutId: string | undefined) {
  return useQuery({
    queryKey: payoutKeys.fees(payoutId ?? ''),
    enabled: !!payoutId,
    queryFn: async (): Promise<PayoutFeeWithLines[]> => {
      const { data: fees, error: feesErr } = await supabase
        .from('payout_fee' as never)
        .select('*')
        .eq('payout_id' as never, payoutId!)
        .order('fee_category' as never);

      if (feesErr) throw feesErr;

      const feeRows = ((fees ?? []) as Record<string, unknown>[]).map(mapPayoutFee);
      if (feeRows.length === 0) return [];

      // Fetch all lines for these fees in one query
      const feeIds = feeRows.map((f) => f.id);
      const { data: lines, error: linesErr } = await supabase
        .from('payout_fee_line' as never)
        .select('*')
        .in('payout_fee_id' as never, feeIds)
        .order('fee_type' as never);

      if (linesErr) throw linesErr;

      const lineRows = ((lines ?? []) as Record<string, unknown>[]).map(mapPayoutFeeLine);

      // Group lines by payout_fee_id
      const linesByFeeId = new Map<string, PayoutFeeLine[]>();
      for (const line of lineRows) {
        const existing = linesByFeeId.get(line.payoutFeeId) ?? [];
        existing.push(line);
        linesByFeeId.set(line.payoutFeeId, existing);
      }

      return feeRows.map((fee) => ({
        ...fee,
        lines: linesByFeeId.get(fee.id) ?? [],
      }));
    },
  });
}

// ─── useOrderFees ───────────────────────────────────────────
// All payout_fee rows for a specific sales order.
// Useful for the order detail view to show fee breakdown.

export function useOrderFees(salesOrderId: string | undefined) {
  return useQuery({
    queryKey: payoutKeys.orderFees(salesOrderId ?? ''),
    enabled: !!salesOrderId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('payout_fee' as never)
        .select('*')
        .eq('sales_order_id' as never, salesOrderId!)
        .order('fee_category' as never);

      if (error) throw error;

      return ((data ?? []) as Record<string, unknown>[]).map(mapPayoutFee);
    },
  });
}

// ─── useUnitProfit ──────────────────────────────────────────
// Queries unit_profit_view.
// Pass a unitId to get a single unit; omit for all sold units.

function mapUnitProfit(row: Record<string, unknown>): UnitProfit {
  return {
    stockUnitId:      row.stock_unit_id as string,
    uid:              (row.uid as string) ?? null,
    sku:              row.sku as string,
    v2Status:         row.v2_status as string,
    batchId:          (row.batch_id as string) ?? null,
    payoutId:         (row.payout_id as string) ?? null,
    salesOrderId:     row.sales_order_id as string,
    grossRevenue:     row.gross_revenue as number,
    landedCost:       row.landed_cost as number,
    sellingFee:       row.selling_fee as number,
    shippingFee:      row.shipping_fee as number,
    processingFee:    row.processing_fee as number,
    advertisingFee:   row.advertising_fee as number,
    totalFeesPerUnit: row.total_fees_per_unit as number,
    netProfit:        row.net_profit as number,
    netMarginPct:     (row.net_margin_pct as number) ?? null,
    grossMarginPct:   (row.gross_margin_pct as number) ?? null,
    feePct:           (row.fee_pct as number) ?? null,
  };
}

export function useUnitProfit(unitId?: string) {
  return useQuery({
    queryKey: payoutKeys.unitProfit(unitId),
    queryFn: async (): Promise<UnitProfit[]> => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let query: any = supabase
        .from('unit_profit_view' as never)
        .select('*');

      if (unitId) {
        query = query.eq('stock_unit_id', unitId);
      }

      const { data, error } = await query;
      if (error) throw error;

      return ((data ?? []) as Record<string, unknown>[]).map(mapUnitProfit);
    },
  });
}

// ─── useUnitProfitSummary ───────────────────────────────────
// Aggregate profit stats across all units — useful for the
// Payouts dashboard summary cards.

export interface UnitProfitSummary {
  totalUnits: number;
  totalRevenue: number;
  totalCost: number;
  totalFees: number;
  totalNetProfit: number;
  avgNetMarginPct: number | null;
  avgFeePct: number | null;
  unitsBelowCost: number;        // net_profit < 0
  unitsWithoutFees: number;      // total_fees_per_unit = 0 (fees not yet attributed)
}

export function useUnitProfitSummary() {
  return useQuery({
    queryKey: [...payoutKeys.unitProfit(), 'summary'],
    queryFn: async (): Promise<UnitProfitSummary> => {
      const { data, error } = await supabase
        .from('unit_profit_view' as never)
        .select('gross_revenue, landed_cost, total_fees_per_unit, net_profit, net_margin_pct, fee_pct');

      if (error) throw error;

      type Row = {
        gross_revenue: number;
        landed_cost: number;
        total_fees_per_unit: number;
        net_profit: number;
        net_margin_pct: number | null;
        fee_pct: number | null;
      };

      const rows = (data ?? []) as Row[];

      if (rows.length === 0) {
        return {
          totalUnits: 0,
          totalRevenue: 0,
          totalCost: 0,
          totalFees: 0,
          totalNetProfit: 0,
          avgNetMarginPct: null,
          avgFeePct: null,
          unitsBelowCost: 0,
          unitsWithoutFees: 0,
        };
      }

      const totalRevenue = rows.reduce((s, r) => s + (r.gross_revenue ?? 0), 0);
      const totalCost    = rows.reduce((s, r) => s + (r.landed_cost ?? 0), 0);
      const totalFees    = rows.reduce((s, r) => s + (r.total_fees_per_unit ?? 0), 0);
      const totalNetProfit = rows.reduce((s, r) => s + (r.net_profit ?? 0), 0);

      const marginsWithData = rows.filter((r) => r.net_margin_pct !== null);
      const avgNetMarginPct = marginsWithData.length > 0
        ? Math.round(
            marginsWithData.reduce((s, r) => s + r.net_margin_pct!, 0) / marginsWithData.length * 100,
          ) / 100
        : null;

      const feesWithData = rows.filter((r) => r.fee_pct !== null);
      const avgFeePct = feesWithData.length > 0
        ? Math.round(
            feesWithData.reduce((s, r) => s + r.fee_pct!, 0) / feesWithData.length * 100,
          ) / 100
        : null;

      return {
        totalUnits:       rows.length,
        totalRevenue:     Math.round(totalRevenue * 100) / 100,
        totalCost:        Math.round(totalCost    * 100) / 100,
        totalFees:        Math.round(totalFees    * 100) / 100,
        totalNetProfit:   Math.round(totalNetProfit * 100) / 100,
        avgNetMarginPct,
        avgFeePct,
        unitsBelowCost:   rows.filter((r) => r.net_profit < 0).length,
        unitsWithoutFees: rows.filter((r) => r.total_fees_per_unit === 0).length,
      };
    },
  });
}
