// ============================================================
// Admin V2 — Intake Hooks
// Query pending inbound receipts and process them into v2 purchase batches.
// ============================================================

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { purchaseBatchKeys } from './use-purchase-batches';

export interface InboundReceipt {
  id: string;
  qboPurchaseId: string;
  vendorName: string | null;
  txnDate: string | null;
  totalAmount: number;
  currency: string;
  status: 'pending' | 'processed' | 'error';
  processedAt: string | null;
  createdAt: string;
  lineCount: number;
  stockLineCount: number;
}

export interface InboundReceiptLine {
  id: string;
  inboundReceiptId: string;
  description: string | null;
  quantity: number;
  unitCost: number;
  lineTotal: number;
  mpn: string | null;
  isStockLine: boolean;
  conditionGrade: string | null;
}

export const intakeKeys = {
  all: ['v2', 'intake'] as const,
  receipt: (id: string) => ['v2', 'intake', id] as const,
};

// ─── List pending/error receipts ─────────────────────────────

export function usePendingReceipts() {
  return useQuery({
    queryKey: intakeKeys.all,
    queryFn: async () => {
      // Fetch receipts that haven't been processed yet
      const { data: receipts, error } = await supabase
        .from('inbound_receipt')
        .select('*, inbound_receipt_line(id, is_stock_line)')
        .in('status', ['pending', 'error'])
        .order('txn_date', { ascending: false });

      if (error) throw error;

      return ((receipts ?? []) as Record<string, unknown>[]).map((r): InboundReceipt => {
        const lines = (r.inbound_receipt_line as Record<string, unknown>[]) ?? [];
        return {
          id: r.id as string,
          qboPurchaseId: r.qbo_purchase_id as string,
          vendorName: (r.vendor_name as string) ?? null,
          txnDate: (r.txn_date as string) ?? null,
          totalAmount: (r.total_amount as number) ?? 0,
          currency: (r.currency as string) ?? 'GBP',
          status: r.status as InboundReceipt['status'],
          processedAt: (r.processed_at as string) ?? null,
          createdAt: r.created_at as string,
          lineCount: lines.length,
          stockLineCount: lines.filter(l => l.is_stock_line === true).length,
        };
      });
    },
  });
}

// ─── Get receipt detail with lines ───────────────────────────

export function useReceiptDetail(receiptId: string | null) {
  return useQuery({
    queryKey: intakeKeys.receipt(receiptId ?? ''),
    enabled: !!receiptId,
    queryFn: async () => {
      const { data: receipt, error: rErr } = await supabase
        .from('inbound_receipt')
        .select('*')
        .eq('id', receiptId!)
        .single();

      if (rErr) throw rErr;

      const { data: lines, error: lErr } = await supabase
        .from('inbound_receipt_line')
        .select('*')
        .eq('inbound_receipt_id', receiptId!)
        .order('created_at');

      if (lErr) throw lErr;

      return {
        receipt: {
          id: (receipt as Record<string, unknown>).id as string,
          qboPurchaseId: (receipt as Record<string, unknown>).qbo_purchase_id as string,
          vendorName: ((receipt as Record<string, unknown>).vendor_name as string) ?? null,
          txnDate: ((receipt as Record<string, unknown>).txn_date as string) ?? null,
          totalAmount: ((receipt as Record<string, unknown>).total_amount as number) ?? 0,
          currency: ((receipt as Record<string, unknown>).currency as string) ?? 'GBP',
          status: (receipt as Record<string, unknown>).status as InboundReceipt['status'],
          processedAt: ((receipt as Record<string, unknown>).processed_at as string) ?? null,
          createdAt: (receipt as Record<string, unknown>).created_at as string,
        },
        lines: ((lines ?? []) as Record<string, unknown>[]).map((l): InboundReceiptLine => ({
          id: l.id as string,
          inboundReceiptId: l.inbound_receipt_id as string,
          description: (l.description as string) ?? null,
          quantity: (l.quantity as number) ?? 1,
          unitCost: (l.unit_cost as number) ?? 0,
          lineTotal: (l.line_total as number) ?? 0,
          mpn: (l.mpn as string) ?? null,
          isStockLine: (l.is_stock_line as boolean) ?? true,
          conditionGrade: (l.condition_grade as string) ?? null,
        })),
      };
    },
  });
}

// ─── Process receipt into v2 purchase batch (server-side) ────

interface ProcessReceiptInput {
  receiptId: string;
}

export function useProcessReceipt() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async ({ receiptId }: ProcessReceiptInput) => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) throw new Error('Not authenticated');

      const response = await supabase.functions.invoke('process-receipt', {
        body: { receipt_id: receiptId },
        headers: { Authorization: `Bearer ${session.access_token}` },
      });

      if (response.error) throw new Error(response.error.message ?? 'Processing failed');
      const result = response.data;
      if (result?.error) throw new Error(result.error);

      return {
        unitsCreated: result.units_created ?? 0,
        totalOverhead: result.total_overhead_apportioned ?? 0,
      };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: intakeKeys.all });
      qc.invalidateQueries({ queryKey: purchaseBatchKeys.all });
    },
  });
}
