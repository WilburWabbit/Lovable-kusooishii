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

// ─── Process receipt into v2 purchase batch ──────────────────

interface ProcessReceiptInput {
  receiptId: string;
  lines: {
    lineId: string;
    mpn: string;
    quantity: number;
    unitCost: number;
    isStockLine: boolean;
  }[];
}

export function useProcessReceipt() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async ({ receiptId, lines }: ProcessReceiptInput) => {
      const stockLines = lines.filter(l => l.isStockLine && l.mpn);
      const nonStockLines = lines.filter(l => !l.isStockLine);

      if (stockLines.length === 0) {
        throw new Error('No stock lines with MPNs to process');
      }

      // Fetch receipt header for batch metadata
      const { data: receipt, error: rErr } = await supabase
        .from('inbound_receipt')
        .select('vendor_name, txn_date, qbo_purchase_id, created_at')
        .eq('id', receiptId)
        .single();

      if (rErr) throw rErr;
      const r = receipt as Record<string, unknown>;

      // Calculate shared costs from non-stock lines
      const totalNonStock = nonStockLines.reduce((sum, l) => sum + l.unitCost * l.quantity, 0);

      // Create purchase batch (uses DB default for PO-NNN ID)
      const { data: batch, error: bErr } = await supabase
        .from('purchase_batches')
        .insert({
          supplier_name: (r.vendor_name as string) ?? 'Unknown Supplier',
          purchase_date: (r.txn_date as string) ?? new Date().toISOString().split('T')[0],
          reference: r.qbo_purchase_id as string,
          supplier_vat_registered: false,
          shared_costs: JSON.stringify({ shipping: 0, broker_fee: 0, other: Math.round(totalNonStock * 100) / 100 }),
          total_shared_costs: Math.round(totalNonStock * 100) / 100,
          status: 'recorded',
        } as never)
        .select('id')
        .single();

      if (bErr) throw bErr;
      const batchId = (batch as Record<string, unknown>).id as string;

      // Create line items
      const lineInserts = stockLines.map(l => ({
        batch_id: batchId,
        mpn: l.mpn,
        quantity: l.quantity,
        unit_cost: l.unitCost,
      }));

      const { data: createdLines, error: lErr } = await supabase
        .from('purchase_line_items')
        .insert(lineInserts as never)
        .select('id, mpn');

      if (lErr) throw lErr;

      // Ensure product records exist for each MPN
      for (const sl of stockLines) {
        await supabase
          .from('product')
          .upsert({ mpn: sl.mpn, name: sl.mpn } as never, { onConflict: 'mpn' });
      }

      // Create stock units — one per quantity per line
      const lineMap = new Map<string, string>();
      for (const cl of (createdLines as Record<string, unknown>[])) {
        lineMap.set(cl.mpn as string, cl.id as string);
      }

      const unitInserts: Record<string, unknown>[] = [];
      for (const sl of stockLines) {
        const lineItemId = lineMap.get(sl.mpn);
        for (let i = 0; i < sl.quantity; i++) {
          unitInserts.push({
            batch_id: batchId,
            line_item_id: lineItemId,
            mpn: sl.mpn,
            v2_status: 'purchased',
            inbound_receipt_line_id: sl.lineId,
          });
        }
      }

      if (unitInserts.length > 0) {
        // Insert in batches of 100
        for (let i = 0; i < unitInserts.length; i += 100) {
          const chunk = unitInserts.slice(i, i + 100);
          const { error: uErr } = await supabase
            .from('stock_unit')
            .insert(chunk as never);
          if (uErr) throw uErr;
        }
      }

      // Run cost apportionment
      await supabase.rpc('v2_calculate_apportioned_costs' as never, { p_batch_id: batchId } as never);

      // Update batch unit counter
      await supabase
        .from('purchase_batches')
        .update({ unit_counter: unitInserts.length } as never)
        .eq('id', batchId);

      // Mark receipt as processed
      await supabase
        .from('inbound_receipt')
        .update({ status: 'processed', processed_at: new Date().toISOString() } as never)
        .eq('id', receiptId);

      return { batchId, unitCount: unitInserts.length, lineCount: stockLines.length };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: intakeKeys.all });
      qc.invalidateQueries({ queryKey: purchaseBatchKeys.all });
    },
  });
}
