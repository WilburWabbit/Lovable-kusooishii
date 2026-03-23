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
  all: ['v2', 'payouts'] as const,
  summary: ['v2', 'payouts', 'summary'] as const,
};

// ─── Row → Interface Mapper ────────────────────────────────

function mapPayout(row: Record<string, unknown>): Payout {
  return {
    id: row.id as string,
    channel: row.channel as PayoutChannel,
    payoutDate: row.payout_date as string,
    grossAmount: row.gross_amount as number,
    totalFees: row.total_fees as number,
    netAmount: row.net_amount as number,
    feeBreakdown: (row.fee_breakdown as FeeBreakdown) ?? { fvf: 0, promoted_listings: 0, international: 0, processing: 0 },
    orderCount: (row.order_count as number) ?? 0,
    unitCount: (row.unit_count as number) ?? 0,
    qboDepositId: (row.qbo_deposit_id as string) ?? null,
    qboExpenseId: (row.qbo_expense_id as string) ?? null,
    qboSyncStatus: (row.qbo_sync_status as QBOSyncStatus) ?? 'pending',
    externalPayoutId: (row.external_payout_id as string) ?? null,
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
        .select('id, order_id, landed_cost, v2_status')
        .in('v2_status' as never, ['delivered', 'sold', 'shipped']);

      if (unitErr) throw unitErr;

      // Get the orders for these units to determine channel
      const orderIds = [
        ...new Set(
          ((pendingUnits ?? []) as Record<string, unknown>[])
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
        for (const unit of ((pendingUnits ?? []) as Record<string, unknown>[])) {
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
        .from('payouts')
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
    },
  });
}
