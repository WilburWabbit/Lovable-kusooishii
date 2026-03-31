// ============================================================
// Admin V2 — Payout Transaction Hooks
// Covers: usePayoutTransactions, useUnmatchedTransactions,
//         useManualMatchTransaction, useSkipTransaction
// ============================================================

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { PayoutTransaction, PayoutTransactionType } from '@/lib/types/admin';
import { payoutKeys } from './use-payouts';

// ─── Query Keys ─────────────────────────────────────────────

export const payoutTxnKeys = {
  byPayout: (payoutId: string) => ['v2', 'payout-transactions', payoutId] as const,
  unmatched: ['v2', 'payout-transactions', 'unmatched'] as const,
};

// ─── Row → Interface Mapper ────────────────────────────────

function mapTransaction(row: Record<string, unknown>): PayoutTransaction {
  return {
    id: row.id as string,
    payoutId: row.payout_id as string,
    transactionId: row.transaction_id as string,
    transactionType: row.transaction_type as PayoutTransactionType,
    transactionStatus: row.transaction_status as string,
    transactionDate: row.transaction_date as string,
    orderId: (row.order_id as string) ?? null,
    buyerUsername: (row.buyer_username as string) ?? null,
    grossAmount: row.gross_amount as number,
    totalFees: row.total_fees as number,
    netAmount: row.net_amount as number,
    currency: (row.currency as string) ?? 'GBP',
    feeDetails: (row.fee_details as Array<{ feeType: string; amount: number }>) ?? [],
    memo: (row.memo as string) ?? null,
    matchedOrderId: (row.matched_order_id as string) ?? null,
    matched: (row.matched as boolean) ?? false,
    matchMethod: (row.match_method as string) ?? null,
    qboSalesReceiptId: (row.qbo_sales_receipt_id as string) ?? null,
    createdAt: row.created_at as string,
  };
}

// ─── usePayoutTransactions ─────────────────────────────────

export function usePayoutTransactions(externalPayoutId: string | null) {
  return useQuery({
    queryKey: payoutTxnKeys.byPayout(externalPayoutId ?? ''),
    enabled: !!externalPayoutId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('ebay_payout_transactions' as never)
        .select('*')
        .eq('payout_id', externalPayoutId!)
        .order('transaction_date', { ascending: true });

      if (error) throw error;
      return ((data ?? []) as Record<string, unknown>[]).map(mapTransaction);
    },
  });
}

// ─── useUnmatchedTransactions ──────────────────────────────

export function useUnmatchedTransactions() {
  return useQuery({
    queryKey: payoutTxnKeys.unmatched,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('ebay_payout_transactions' as never)
        .select('*')
        .eq('matched', false)
        .eq('transaction_type', 'SALE')
        .order('transaction_date', { ascending: false });

      if (error) throw error;
      return ((data ?? []) as Record<string, unknown>[]).map(mapTransaction);
    },
  });
}

// ─── useManualMatchTransaction ─────────────────────────────

export function useManualMatchTransaction() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ transactionId, orderId, qboSalesReceiptId }: {
      transactionId: string;
      orderId: string;
      qboSalesReceiptId?: string;
    }) => {
      const { error } = await supabase
        .from('ebay_payout_transactions' as never)
        .update({
          matched_order_id: orderId,
          matched: true,
          match_method: 'manual',
          qbo_sales_receipt_id: qboSalesReceiptId ?? null,
        } as never)
        .eq('id', transactionId);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['v2', 'payout-transactions'] });
      queryClient.invalidateQueries({ queryKey: payoutKeys.all });
    },
  });
}

// ─── useSkipTransaction ────────────────────────────────────

export function useSkipTransaction() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (transactionId: string) => {
      const { error } = await supabase
        .from('ebay_payout_transactions' as never)
        .update({
          matched: true,
          match_method: 'skipped',
        } as never)
        .eq('id', transactionId);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['v2', 'payout-transactions'] });
      queryClient.invalidateQueries({ queryKey: payoutKeys.all });
    },
  });
}
