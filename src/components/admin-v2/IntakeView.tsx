// ============================================================
// Admin V2 — Intake View
// Shows pending inbound receipts from QBO and processes them
// into v2 purchase batches with stock units.
// ============================================================

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { SurfaceCard, SectionHead, Badge, Mono } from './ui-primitives';
import {
  usePendingReceipts,
  useReceiptDetail,
  useProcessReceipt,
  type InboundReceiptLine,
} from '@/hooks/admin/use-intake';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';

export function IntakeView() {
  const navigate = useNavigate();
  const { data: receipts, isLoading } = usePendingReceipts();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  if (isLoading) return <p className="text-xs text-zinc-500 py-4">Loading receipts...</p>;

  if (!receipts || receipts.length === 0) {
    return (
      <div className="space-y-4">
        <Header />
        <SurfaceCard>
          <div className="py-8 text-center">
            <p className="text-sm text-zinc-600">No pending receipts</p>
            <p className="text-xs text-zinc-500 mt-1">
              All QBO purchases have been processed. Sync new purchases from Settings.
            </p>
          </div>
        </SurfaceCard>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Header />

      {selectedId ? (
        <ReceiptDetail
          receiptId={selectedId}
          onBack={() => setSelectedId(null)}
          onProcessed={(batchId) => {
            setSelectedId(null);
            navigate(`/admin/purchases/${batchId}`);
          }}
        />
      ) : (
        <SurfaceCard>
          <SectionHead>{receipts.length} pending receipt{receipts.length !== 1 ? 's' : ''}</SectionHead>
          <div className="overflow-x-auto mt-3 rounded border border-zinc-200">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-zinc-50">
                  <th className="px-3 py-2 text-left text-zinc-500 font-medium">Date</th>
                  <th className="px-3 py-2 text-left text-zinc-500 font-medium">Supplier</th>
                  <th className="px-3 py-2 text-left text-zinc-500 font-medium">QBO Ref</th>
                  <th className="px-3 py-2 text-right text-zinc-500 font-medium">Amount</th>
                  <th className="px-3 py-2 text-right text-zinc-500 font-medium">Lines</th>
                  <th className="px-3 py-2 text-right text-zinc-500 font-medium">Stock</th>
                  <th className="px-3 py-2 text-left text-zinc-500 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {receipts.map((r) => (
                  <tr
                    key={r.id}
                    onClick={() => setSelectedId(r.id)}
                    className="border-t border-zinc-100 hover:bg-zinc-50 cursor-pointer transition-colors"
                  >
                    <td className="px-3 py-2">
                      <Mono className="text-[11px]">
                        {r.txnDate ? new Date(r.txnDate).toLocaleDateString('en-GB') : '\u2014'}
                      </Mono>
                    </td>
                    <td className="px-3 py-2 text-zinc-700">{r.vendorName ?? '\u2014'}</td>
                    <td className="px-3 py-2">
                      <Mono className="text-[10px]">{r.qboPurchaseId}</Mono>
                    </td>
                    <td className="px-3 py-2 text-right">
                      <Mono color="teal" className="text-[11px]">
                        {r.currency === 'GBP' ? '\u00A3' : r.currency}{r.totalAmount.toFixed(2)}
                      </Mono>
                    </td>
                    <td className="px-3 py-2 text-right">{r.lineCount}</td>
                    <td className="px-3 py-2 text-right">
                      <Mono color="amber">{r.stockLineCount}</Mono>
                    </td>
                    <td className="px-3 py-2">
                      <Badge
                        label={r.status}
                        color={r.status === 'error' ? '#EF4444' : '#71717A'}
                        small
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </SurfaceCard>
      )}
    </div>
  );
}

function Header() {
  return (
    <div>
      <h1 className="text-lg font-bold text-zinc-900">Intake</h1>
      <p className="text-xs text-zinc-500 mt-1">
        Process QBO receipts into purchase batches and stock units.
      </p>
    </div>
  );
}

// ─── Receipt Detail ──────────────────────────────────────────

function ReceiptDetail({
  receiptId,
  onBack,
  onProcessed,
}: {
  receiptId: string;
  onBack: () => void;
  onProcessed: (batchId: string) => void;
}) {
  const { data, isLoading } = useReceiptDetail(receiptId);
  const processReceipt = useProcessReceipt();

  // Local editable state for line MPNs
  const [lineEdits, setLineEdits] = useState<Map<string, { mpn: string; isStock: boolean }>>(new Map());

  const getLineMpn = (line: InboundReceiptLine) => {
    const edit = lineEdits.get(line.id);
    return edit?.mpn ?? line.mpn ?? '';
  };

  const getLineIsStock = (line: InboundReceiptLine) => {
    const edit = lineEdits.get(line.id);
    return edit?.isStock ?? line.isStockLine;
  };

  const updateLine = (lineId: string, field: 'mpn' | 'isStock', value: string | boolean) => {
    setLineEdits((prev) => {
      const next = new Map(prev);
      const existing = next.get(lineId) ?? { mpn: '', isStock: true };
      next.set(lineId, { ...existing, [field]: value });
      return next;
    });
  };

  const handleProcess = async () => {
    if (!data) return;

    const lines = data.lines.map((l) => ({
      lineId: l.id,
      mpn: getLineMpn(l),
      quantity: l.quantity,
      unitCost: l.unitCost,
      isStockLine: getLineIsStock(l),
    }));

    const stockLines = lines.filter(l => l.isStockLine && l.mpn.trim());
    if (stockLines.length === 0) {
      toast.error('No stock lines with MPNs to process');
      return;
    }

    try {
      const result = await processReceipt.mutateAsync({
        receiptId,
        lines,
      });
      toast.success(`Created batch with ${result.unitCount} units`);
      onProcessed(result.batchId);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Processing failed');
    }
  };

  if (isLoading || !data) {
    return <p className="text-xs text-zinc-500 py-4">Loading receipt...</p>;
  }

  const { receipt, lines } = data;
  const stockLines = lines.filter(l => getLineIsStock(l) && getLineMpn(l).trim());
  const nonStockTotal = lines
    .filter(l => !getLineIsStock(l))
    .reduce((s, l) => s + l.lineTotal, 0);

  return (
    <SurfaceCard>
      <div className="flex items-center justify-between mb-4">
        <button
          onClick={onBack}
          className="text-xs text-zinc-500 hover:text-zinc-700 transition-colors"
        >
          &larr; Back to list
        </button>
        <Badge
          label={receipt.status}
          color={receipt.status === 'error' ? '#EF4444' : '#71717A'}
        />
      </div>

      {/* Receipt header */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs mb-5">
        <div className="bg-zinc-50 rounded px-3 py-2">
          <div className="text-zinc-500">Supplier</div>
          <div className="text-zinc-900 font-medium">{receipt.vendorName ?? '\u2014'}</div>
        </div>
        <div className="bg-zinc-50 rounded px-3 py-2">
          <div className="text-zinc-500">Date</div>
          <div className="text-zinc-900">{receipt.txnDate ? new Date(receipt.txnDate).toLocaleDateString('en-GB') : '\u2014'}</div>
        </div>
        <div className="bg-zinc-50 rounded px-3 py-2">
          <div className="text-zinc-500">QBO Total</div>
          <Mono color="teal">{'\u00A3'}{receipt.totalAmount.toFixed(2)}</Mono>
        </div>
        <div className="bg-zinc-50 rounded px-3 py-2">
          <div className="text-zinc-500">Shared Costs</div>
          <Mono color="amber">{'\u00A3'}{nonStockTotal.toFixed(2)}</Mono>
        </div>
      </div>

      {/* Line items table */}
      <SectionHead>Line Items ({lines.length})</SectionHead>
      <div className="overflow-x-auto mt-2 rounded border border-zinc-200">
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-zinc-50">
              <th className="px-3 py-2 text-left text-zinc-500 font-medium w-8">Stock</th>
              <th className="px-3 py-2 text-left text-zinc-500 font-medium">Description</th>
              <th className="px-3 py-2 text-left text-zinc-500 font-medium">MPN</th>
              <th className="px-3 py-2 text-right text-zinc-500 font-medium">Qty</th>
              <th className="px-3 py-2 text-right text-zinc-500 font-medium">Unit Cost</th>
              <th className="px-3 py-2 text-right text-zinc-500 font-medium">Total</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => {
              const isStock = getLineIsStock(l);
              const mpn = getLineMpn(l);
              return (
                <tr key={l.id} className={`border-t border-zinc-100 ${!isStock ? 'bg-zinc-50/50' : ''}`}>
                  <td className="px-3 py-2">
                    <input
                      type="checkbox"
                      checked={isStock}
                      onChange={(e) => updateLine(l.id, 'isStock', e.target.checked)}
                      className="rounded border-zinc-300"
                    />
                  </td>
                  <td className="px-3 py-2 text-zinc-600 max-w-[200px] truncate">
                    {l.description ?? '\u2014'}
                  </td>
                  <td className="px-3 py-2">
                    {isStock ? (
                      <input
                        type="text"
                        value={mpn}
                        onChange={(e) => updateLine(l.id, 'mpn', e.target.value)}
                        placeholder="e.g. 75367-1"
                        className={`w-24 px-1.5 py-0.5 text-xs font-mono border rounded focus:outline-none focus:ring-1 focus:ring-amber-400 ${
                          isStock && !mpn.trim() ? 'border-red-300 bg-red-50' : 'border-zinc-300'
                        }`}
                      />
                    ) : (
                      <span className="text-zinc-400 text-[10px]">non-stock</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right">{l.quantity}</td>
                  <td className="px-3 py-2 text-right">
                    <Mono className="text-[11px]">{'\u00A3'}{l.unitCost.toFixed(2)}</Mono>
                  </td>
                  <td className="px-3 py-2 text-right">
                    <Mono className="text-[11px]">{'\u00A3'}{l.lineTotal.toFixed(2)}</Mono>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Summary + Process button */}
      <div className="flex items-center justify-between mt-4 pt-3 border-t border-zinc-200">
        <div className="text-xs text-zinc-500">
          {stockLines.length} stock line{stockLines.length !== 1 ? 's' : ''} with MPN
          {nonStockTotal > 0 && <> &middot; {'\u00A3'}{nonStockTotal.toFixed(2)} shared costs</>}
        </div>
        <button
          onClick={handleProcess}
          disabled={stockLines.length === 0 || processReceipt.isPending}
          className="px-4 py-2 rounded text-sm font-medium bg-amber-500 text-white hover:bg-amber-400 transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2"
        >
          {processReceipt.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          Process into Batch
        </button>
      </div>
    </SurfaceCard>
  );
}
