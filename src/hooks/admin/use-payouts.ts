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
  orders:     (payoutId: string)    => ['v2', 'payouts', payoutId, 'orders']  as const,
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
  netRevenue: number;
  netLandedCost: number;
  netTotalFees: number;
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
    qboSyncError: (row.qbo_sync_error as string) ?? null,
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

// ─── usePayout (single) ─────────────────────────────────────

export function usePayout(payoutId: string) {
  return useQuery({
    queryKey: ['v2', 'payout', payoutId] as const,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('payouts' as never)
        .select('*')
        .eq('id' as never, payoutId)
        .single();

      if (error) throw error;
      return mapPayout(data as Record<string, unknown>);
    },
  });
}

// ─── usePayoutOrders ────────────────────────────────────────
// Fallback for linked orders when payout_fee data is absent.

export interface PayoutOrderLink {
  salesOrderId: string;
  orderGross: number | null;
  orderFees: number | null;
  orderNet: number | null;
  orderNumber: string | null;
  originReference: string | null;
  v2Status: string | null;
}

export function usePayoutOrders(payoutId: string | undefined) {
  return useQuery({
    queryKey: payoutKeys.orders(payoutId ?? ''),
    enabled: !!payoutId,
    queryFn: async (): Promise<PayoutOrderLink[]> => {
      const { data, error } = await supabase
        .from('payout_orders')
        .select('sales_order_id, order_gross, order_fees, order_net, sales_order:sales_order!inner(order_number, origin_reference, v2_status)')
        .eq('payout_id', payoutId!);

      if (error) throw error;

      return ((data ?? []) as unknown as Array<{
        sales_order_id: string;
        order_gross: number | null;
        order_fees: number | null;
        order_net: number | null;
        sales_order: { order_number: string | null; origin_reference: string | null; v2_status: string | null };
      }>).map((r) => ({
        salesOrderId: r.sales_order_id,
        orderGross: r.order_gross,
        orderFees: r.order_fees,
        orderNet: r.order_net,
        orderNumber: r.sales_order?.order_number ?? null,
        originReference: r.sales_order?.origin_reference ?? null,
        v2Status: r.sales_order?.v2_status ?? null,
      }));
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

      // Blue Bell commission is now owned by the sales-program accrual
      // ledger. Legacy sales_order.blue_bell_club remains only for
      // compatibility during cutover.
      const { data: blueBellProgram, error: programErr } = await supabase
        .from('sales_program' as never)
        .select('id')
        .eq('program_code' as never, 'blue_bell')
        .maybeSingle();

      if (programErr) throw programErr;

      const programId = (blueBellProgram as unknown as Record<string, unknown> | null)?.id as string | undefined;
      let blueBellOutstanding = 0;
      let blueBellOrderCount = 0;

      if (programId) {
        const { data: accruals, error: accrualErr } = await supabase
          .from('sales_program_accrual' as never)
          .select('sales_order_id, commission_amount, reversed_amount')
          .eq('sales_program_id' as never, programId)
          .in('status' as never, ['open', 'partially_settled']);

        if (accrualErr) throw accrualErr;

        const qualifyingOrders = new Set<string>();
        for (const accrual of ((accruals ?? []) as unknown as Record<string, unknown>[])) {
          blueBellOutstanding +=
            Number(accrual.commission_amount ?? 0) - Number(accrual.reversed_amount ?? 0);
          if (accrual.sales_order_id) qualifyingOrders.add(accrual.sales_order_id as string);
        }

        blueBellOutstanding = Math.max(0, Math.round(blueBellOutstanding * 100) / 100);
        blueBellOrderCount = qualifyingOrders.size;
      }

      return {
        pendingByChannel: channelSummary,
        blueBellCommission: {
          owedSinceLastPayment: blueBellOutstanding,
          qualifyingOrderCount: blueBellOrderCount,
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
    onSuccess: (_data, payoutId) => {
      queryClient.invalidateQueries({ queryKey: payoutKeys.all });
      queryClient.invalidateQueries({ queryKey: payoutKeys.summary });
      queryClient.invalidateQueries({ queryKey: payoutKeys.orders(payoutId) });
    },
  });
}

// ─── useTriggerPayoutQBOSync ────────────────────────────────

export function useTriggerPayoutQBOSync() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (payoutId: string) => {
      const { data: intentId, error: queueError } = await supabase.rpc(
        'queue_qbo_payout_posting_intent' as never,
        { p_payout_id: payoutId } as never,
      );

      if (queueError) throw queueError;

      const { data, error } = await supabase.functions.invoke('accounting-posting-intents-process', {
        body: intentId ? { intentId } : { batch_size: 5 },
      });

      if (error) throw error;
      return { ...(data as Record<string, unknown>), posting_intent_id: intentId };
    },
    onSuccess: (_data, payoutId) => {
      queryClient.invalidateQueries({ queryKey: payoutKeys.all });
      queryClient.invalidateQueries({ queryKey: ['v2', 'payout', payoutId] as const });
      queryClient.invalidateQueries({ queryKey: ['v2', 'payout-transactions'] });
      queryClient.invalidateQueries({ queryKey: ['v2', 'payout-qbo-readiness'] });
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

// ─── usePayoutUnitCount ─────────────────────────────────────
// Count of stock units linked to a specific payout.

export function usePayoutUnitCount(payoutId: string | undefined) {
  return useQuery({
    queryKey: ['v2', 'payout-unit-count', payoutId ?? ''] as const,
    enabled: !!payoutId,
    queryFn: async (): Promise<number> => {
      // First try direct payout_id link
      const { count: directCount, error: directErr } = await supabase
        .from('stock_unit')
        .select('id', { count: 'exact', head: true })
        .eq('payout_id' as never, payoutId!);

      if (directErr) throw directErr;
      if ((directCount ?? 0) > 0) return directCount ?? 0;

      // Fallback: count units via linked orders in payout_orders
      const { data: poLinks } = await supabase
        .from('payout_orders' as never)
        .select('sales_order_id')
        .eq('payout_id' as never, payoutId!);

      const orderIds = ((poLinks ?? []) as Record<string, unknown>[])
        .map((r) => r.sales_order_id as string)
        .filter(Boolean);

      if (orderIds.length === 0) return 0;

      const { count: orderUnitCount, error: ouErr } = await supabase
        .from('stock_unit')
        .select('id', { count: 'exact', head: true })
        .in('order_id' as never, orderIds);

      if (ouErr) throw ouErr;
      return orderUnitCount ?? 0;
    },
  });
}

// ─── usePayoutTransactions ──────────────────────────────────
// Raw channel transactions (eBay/Stripe) for a payout, with matched order data.

export interface PayoutTransaction {
  id: string;
  transactionId: string;
  transactionType: string;
  transactionStatus: string;
  transactionDate: string;
  orderId: string | null;
  buyerUsername: string | null;
  memo: string | null;
  grossAmount: number;
  totalFees: number;
  netAmount: number;
  feeDetails: Array<{ feeType: string; amount: number; currency: string }>;
  currency: string;
  matched: boolean;
  matchedOrderId: string | null;
  matchMethod: string | null;
  qboPurchaseId: string | null;
  // Joined from sales_order when matched
  appGross: number | null;
}

export function usePayoutTransactions(externalPayoutId: string | null | undefined) {
  return useQuery({
    queryKey: ['v2', 'payout-transactions', externalPayoutId ?? ''] as const,
    enabled: !!externalPayoutId,
    queryFn: async (): Promise<PayoutTransaction[]> => {
      const { data, error } = await supabase
        .from('ebay_payout_transactions')
        .select('*, qbo_purchase_id')
        .eq('payout_id', externalPayoutId!)
        .order('transaction_date', { ascending: true });

      if (error) throw error;

      const rows = (data ?? []) as Record<string, unknown>[];

      // Collect matched order IDs to fetch app gross in one query
      const matchedIds = rows
        .map((r) => r.matched_order_id as string | null)
        .filter(Boolean) as string[];

      const orderGrossMap = new Map<string, number>();
      if (matchedIds.length > 0) {
        const { data: orders } = await supabase
          .from('sales_order')
          .select('id, gross_total')
          .in('id', matchedIds);

        for (const o of ((orders ?? []) as Record<string, unknown>[])) {
          orderGrossMap.set(o.id as string, o.gross_total as number);
        }
      }

      return rows.map((r) => ({
        id: r.id as string,
        transactionId: r.transaction_id as string,
        transactionType: r.transaction_type as string,
        transactionStatus: r.transaction_status as string,
        transactionDate: r.transaction_date as string,
        orderId: (r.order_id as string) ?? null,
        buyerUsername: (r.buyer_username as string) ?? null,
        memo: (r.memo as string) ?? null,
        grossAmount: r.gross_amount as number,
        totalFees: r.total_fees as number,
        netAmount: r.net_amount as number,
        feeDetails: (r.fee_details as PayoutTransaction['feeDetails']) ?? [],
        currency: r.currency as string,
        matched: r.matched as boolean,
        matchedOrderId: (r.matched_order_id as string) ?? null,
        matchMethod: (r.match_method as string) ?? null,
        qboPurchaseId: (r.qbo_purchase_id as string) ?? null,
        appGross: r.matched_order_id
          ? (orderGrossMap.get(r.matched_order_id as string) ?? null)
          : null,
      }));
    },
  });
}

// ─── usePayoutQBOReadiness ──────────────────────────────────
// Checks whether all linked SALE transactions have synced SalesReceipts,
// and reports expense creation status for non-TRANSFER transactions.

export interface PayoutQBOReadiness {
  ready: boolean;
  // Sales
  totalOrders: number;
  syncedOrders: number;
  unsyncedOrders: { id: string; reference: string | null; qboStatus: string | null }[];
  // Expenses
  totalExpenses: number;
  createdExpenses: number;
  pendingExpenses: { transactionId: string; type: string; amount: number }[];
}

export function usePayoutQBOReadiness(externalPayoutId: string | null | undefined) {
  return useQuery({
    queryKey: ['v2', 'payout-qbo-readiness', externalPayoutId ?? ''] as const,
    enabled: !!externalPayoutId,
    queryFn: async (): Promise<PayoutQBOReadiness> => {
      // Fetch all non-TRANSFER transactions for this payout
      const { data: txData, error: txErr } = await supabase
        .from('ebay_payout_transactions')
        .select('id, transaction_type, transaction_id, order_id, gross_amount, total_fees, matched_order_id, qbo_purchase_id, memo')
        .eq('payout_id', externalPayoutId!)
        .neq('transaction_type', 'TRANSFER');

      if (txErr) throw txErr;

      const txRows = (txData ?? []) as Record<string, unknown>[];

      // Split into sales
      const saleTxs = txRows.filter((r) => r.transaction_type === 'SALE');

      // --- Order matching: try matched_order_id first, fallback to order_id → origin_reference ---
      const matchedOrderIds = saleTxs
        .map((r) => r.matched_order_id as string | null)
        .filter(Boolean) as string[];

      // Collect order_ids for unmatched SALE txns to attempt fallback lookup
      const unmatchedOrderRefs = saleTxs
        .filter((r) => !r.matched_order_id && r.order_id)
        .map((r) => r.order_id as string);

      let syncedOrders = 0;
      const unsyncedOrders: { id: string; reference: string | null; qboStatus: string | null }[] = [];

      // Map of order_id (origin_reference) → sales_order for fallback matching
      const orderByRef = new Map<string, Record<string, unknown>>();

      // Fetch orders by direct ID
      if (matchedOrderIds.length > 0) {
        const { data: orders, error: soErr } = await supabase
          .from('sales_order')
          .select('id, origin_reference, qbo_sales_receipt_id, qbo_sync_status')
          .in('id', matchedOrderIds);

        if (soErr) throw soErr;

        for (const so of ((orders ?? []) as Record<string, unknown>[])) {
          if (so.qbo_sales_receipt_id) {
            syncedOrders++;
          } else {
            unsyncedOrders.push({
              id: so.id as string,
              reference: (so.origin_reference as string) ?? null,
              qboStatus: (so.qbo_sync_status as string) ?? null,
            });
          }
        }
      }

      // Fallback: lookup by origin_reference for unmatched SALE txns
      if (unmatchedOrderRefs.length > 0) {
        const { data: refOrders } = await supabase
          .from('sales_order')
          .select('id, origin_reference, qbo_sales_receipt_id, qbo_sync_status')
          .in('origin_reference', unmatchedOrderRefs);

        for (const so of ((refOrders ?? []) as Record<string, unknown>[])) {
          orderByRef.set(so.origin_reference as string, so);
        }

        for (const tx of saleTxs.filter((r) => !r.matched_order_id && r.order_id)) {
          const ordRef = tx.order_id as string;
          const so = orderByRef.get(ordRef);
          if (so) {
            if (so.qbo_sales_receipt_id) {
              syncedOrders++;
            } else {
              unsyncedOrders.push({
                id: so.id as string,
                reference: (so.origin_reference as string) ?? null,
                qboStatus: (so.qbo_sync_status as string) ?? null,
              });
            }
          } else {
            // Truly unmatched — no sales order found at all
            unsyncedOrders.push({
              id: tx.id as string,
              reference: ordRef,
              qboStatus: 'unmatched',
            });
          }
        }
      }

      // Also count SALE txns with neither matched_order_id nor order_id
      const fullyUnmatched = saleTxs.filter((r) => !r.matched_order_id && !r.order_id);
      for (const tx of fullyUnmatched) {
        unsyncedOrders.push({
          id: tx.id as string,
          reference: (tx.transaction_id as string) ?? null,
          qboStatus: 'unmatched',
        });
      }

      // --- Expense readiness: ALL non-TRANSFER txns that need a QBO Purchase ---
      // SALE txns with total_fees > 0 need an expense for fees
      // SHIPPING_LABEL, NON_SALE_CHARGE, etc. need expenses for their amounts
      const expenseTxs = txRows.filter((r) => {
        const txType = r.transaction_type as string;
        if (txType === 'SALE') {
          return (r.total_fees as number) > 0;
        }
        return true; // all other non-TRANSFER types
      });

      const createdExpenses = expenseTxs.filter((r) => !!r.qbo_purchase_id).length;
      const pendingExpenses = expenseTxs
        .filter((r) => !r.qbo_purchase_id)
        .map((r) => {
          const txType = r.transaction_type as string;
          return {
            transactionId: r.transaction_id as string,
            type: txType === 'SALE' ? 'SALE_FEES' : txType,
            amount: txType === 'SALE'
              ? Math.abs(r.total_fees as number)
              : Math.abs(r.gross_amount as number),
          };
        });

      return {
        ready: unsyncedOrders.length === 0 && saleTxs.length === syncedOrders,
        totalOrders: saleTxs.length,
        syncedOrders,
        unsyncedOrders,
        totalExpenses: expenseTxs.length,
        createdExpenses,
        pendingExpenses,
      };
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
    netRevenue:       (row.net_revenue as number) ?? 0,
    netLandedCost:    (row.net_landed_cost as number) ?? 0,
    netTotalFees:     (row.net_total_fees as number) ?? 0,
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

// ─── Reset Payout Sync ─────────────────────────────────────

export function useResetPayoutSync() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ payoutId, scope }: { payoutId: string; scope: 'expenses' | 'deposit' | 'all' }) => {
      const { data, error } = await supabase.functions.invoke('admin-data', {
        body: { action: 'reset_payout_sync', payoutId, scope },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: payoutKeys.all });
      queryClient.invalidateQueries({ queryKey: ['v2', 'payout-qbo-readiness'] });
    },
  });
}
