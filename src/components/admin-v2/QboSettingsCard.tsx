// ============================================================
// Admin V2 — QBO Settings Card
// Connect/disconnect, sync triggers, process pending, reconcile.
// Ported from v1 QboSettingsPanel using v2 design primitives.
// ============================================================

import { useState, useRef } from 'react';
import { SurfaceCard, SectionHead, Badge, Mono } from './ui-primitives';
import { invokeWithAuth } from '@/lib/invokeWithAuth';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';

function generateMonthList(): string[] {
  const months: string[] = [];
  const now = new Date();
  let year = now.getFullYear();
  let month = now.getMonth() + 1;
  const endYear = 2023;
  const endMonth = 4;
  while (year > endYear || (year === endYear && month >= endMonth)) {
    months.push(`${year}-${String(month).padStart(2, '0')}`);
    month--;
    if (month < 1) { month = 12; year--; }
  }
  return months;
}

type QboStatus = { connected: boolean; realm_id?: string; last_updated?: string };

export function QboSettingsCard() {
  const [status, setStatus] = useState<QboStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [syncLabel, setSyncLabel] = useState('');
  const [syncPct, setSyncPct] = useState(0);
  const [syncingSales, setSyncingSales] = useState(false);
  const [salesLabel, setSalesLabel] = useState('');
  const [salesPct, setSalesPct] = useState(0);
  const [syncingCustomers, setSyncingCustomers] = useState(false);
  const [syncingItems, setSyncingItems] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [processLabel, setProcessLabel] = useState('');
  const [reconciling, setReconciling] = useState(false);
  const [reconcileDetails, setReconcileDetails] = useState<Record<string, unknown>[] | null>(null);
  const [rebuilding, setRebuilding] = useState(false);
  const [rebuildPhase, setRebuildPhase] = useState('');
  const [disconnecting, setDisconnecting] = useState(false);

  const cancelPurchases = useRef(false);
  const cancelSales = useRef(false);

  const anyBusy = syncing || syncingSales || syncingCustomers || syncingItems || processing || reconciling || rebuilding;

  // ── Fetch status on mount ──
  useState(() => {
    (async () => {
      try {
        const data = await invokeWithAuth<QboStatus>('qbo-auth', { action: 'status' });
        setStatus(data && !('error' in data) ? data : { connected: false });
      } catch {
        setStatus({ connected: false });
      } finally {
        setLoading(false);
      }
    })();
  });

  // ── Helpers ──

  const drainPending = async () => {
    setProcessing(true);
    let total = 0;
    try {
      for (let i = 0; i < 100; i++) {
        setProcessLabel(`Auto-processing... (${total} committed)`);
        const data = await invokeWithAuth<Record<string, unknown>>('qbo-process-pending', { batch_size: 50 });
        if ((data as Record<string, unknown>)?.error) throw new Error(String((data as Record<string, unknown>).error));
        const r = (data as Record<string, unknown>).results as Record<string, Record<string, number>> | undefined;
        if (r) {
          total += (r.items?.processed ?? 0) + (r.purchases?.processed ?? 0) +
            (r.sales?.processed ?? 0) + (r.refunds?.processed ?? 0) + (r.customers?.processed ?? 0);
        }
        if (!(data as Record<string, unknown>).has_more) break;
      }
      if (total > 0) toast.success(`Auto-processed ${total} records`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Processing failed');
    } finally {
      setProcessing(false);
      setProcessLabel('');
    }
  };

  // ── Actions ──

  const connect = async () => {
    try {
      const data = await invokeWithAuth<Record<string, unknown>>('qbo-auth', { action: 'authorize_url' });
      if (data?.error) throw new Error(String(data.error));
      window.location.href = data.url as string;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to connect');
    }
  };

  const disconnect = async () => {
    if (!status?.realm_id) return;
    setDisconnecting(true);
    try {
      await invokeWithAuth('qbo-auth', { action: 'disconnect', realm_id: status.realm_id });
      setStatus({ connected: false });
      toast.success('Disconnected from QBO');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Disconnect failed');
    } finally {
      setDisconnecting(false);
    }
  };

  const syncPurchases = async () => {
    setSyncing(true);
    cancelPurchases.current = false;
    const months = generateMonthList();
    let landed = 0, skipped = 0;
    try {
      for (let i = 0; i < months.length; i++) {
        if (cancelPurchases.current) break;
        setSyncLabel(`${months[i]} (${i + 1}/${months.length})`);
        setSyncPct(((i + 1) / months.length) * 100);
        const d = await invokeWithAuth<Record<string, unknown>>('qbo-sync-purchases', { month: months[i] });
        if ((d as Record<string, unknown>)?.error) throw new Error(String((d as Record<string, unknown>).error));
        landed += ((d as Record<string, unknown>).landed as number) ?? 0;
        skipped += ((d as Record<string, unknown>).skipped_existing as number) ?? ((d as Record<string, unknown>).skipped as number) ?? 0;
      }
      toast.success(`Purchases: ${landed} landed, ${skipped} unchanged`);
      if (!cancelPurchases.current && landed > 0) await drainPending();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Purchase sync failed');
    } finally {
      setSyncing(false);
      setSyncLabel('');
      setSyncPct(0);
    }
  };

  const syncSalesAction = async () => {
    setSyncingSales(true);
    cancelSales.current = false;
    const months = generateMonthList();
    let landed = 0, skipped = 0;
    try {
      for (let i = 0; i < months.length; i++) {
        if (cancelSales.current) break;
        setSalesLabel(`${months[i]} (${i + 1}/${months.length})`);
        setSalesPct(((i + 1) / months.length) * 100);
        const d = await invokeWithAuth<Record<string, unknown>>('qbo-sync-sales', { month: months[i] });
        if ((d as Record<string, unknown>)?.error) throw new Error(String((d as Record<string, unknown>).error));
        landed += ((d as Record<string, unknown>).sales_landed as number ?? 0) + ((d as Record<string, unknown>).refunds_landed as number ?? 0);
        skipped += ((d as Record<string, unknown>).sales_skipped as number ?? 0) + ((d as Record<string, unknown>).refunds_skipped as number ?? 0);
      }
      toast.success(`Sales: ${landed} landed, ${skipped} unchanged`);
      if (!cancelSales.current && landed > 0) await drainPending();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Sales sync failed');
    } finally {
      setSyncingSales(false);
      setSalesLabel('');
      setSalesPct(0);
    }
  };

  const syncCustomersAction = async () => {
    setSyncingCustomers(true);
    try {
      const d = await invokeWithAuth<Record<string, unknown>>('qbo-sync-customers');
      if ((d as Record<string, unknown>)?.error) throw new Error(String((d as Record<string, unknown>).error));
      toast.success(`Customers: ${(d as Record<string, unknown>).landed ?? 0} landed, ${(d as Record<string, unknown>).skipped ?? 0} unchanged`);
      if (((d as Record<string, unknown>).landed as number) > 0) await drainPending();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Customer sync failed');
    } finally {
      setSyncingCustomers(false);
    }
  };

  const syncItemsAction = async () => {
    setSyncingItems(true);
    try {
      const d = await invokeWithAuth<Record<string, unknown>>('qbo-sync-items');
      if ((d as Record<string, unknown>)?.error) throw new Error(String((d as Record<string, unknown>).error));
      toast.success(`Items: ${(d as Record<string, unknown>).landed ?? 0} landed, ${(d as Record<string, unknown>).skipped ?? 0} unchanged`);
      if (((d as Record<string, unknown>).landed as number) > 0) await drainPending();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Item sync failed');
    } finally {
      setSyncingItems(false);
    }
  };

  const processPending = async () => {
    setProcessing(true);
    setProcessLabel('Processing all pending...');
    try {
      const d = await invokeWithAuth<Record<string, unknown>>('qbo-process-pending', { batch_size: 50 });
      if ((d as Record<string, unknown>)?.error) throw new Error(String((d as Record<string, unknown>).error));
      const r = (d as Record<string, unknown>).results as Record<string, Record<string, number>> | undefined;
      const parts: string[] = [];
      if (r?.items?.processed) parts.push(`${r.items.processed} items`);
      if (r?.purchases?.processed) parts.push(`${r.purchases.processed} purchases`);
      if (r?.sales?.processed) parts.push(`${r.sales.processed} sales`);
      if (r?.customers?.processed) parts.push(`${r.customers.processed} customers`);
      toast.success(parts.length > 0 ? parts.join(', ') : 'Nothing to process');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Processing failed');
    } finally {
      setProcessing(false);
      setProcessLabel('');
    }
  };

  const reconcileStock = async () => {
    setReconciling(true);
    setReconcileDetails(null);
    try {
      const d = await invokeWithAuth<Record<string, unknown>>('admin-data', { action: 'reconcile-stock' });
      if ((d as Record<string, unknown>)?.error) throw new Error(String((d as Record<string, unknown>).error));
      const parts = [`${(d as Record<string, unknown>).total_checked ?? 0} SKUs checked`];
      if ((d as Record<string, unknown>).stock_reopened) parts.push(`${(d as Record<string, unknown>).stock_reopened} reopened`);
      if ((d as Record<string, unknown>).stock_closed) parts.push(`${(d as Record<string, unknown>).stock_closed} closed`);
      toast.success(parts.join(', '));
      if (((d as Record<string, unknown>).details as unknown[])?.length > 0) {
        setReconcileDetails((d as Record<string, unknown>).details as Record<string, unknown>[]);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Reconciliation failed');
    } finally {
      setReconciling(false);
    }
  };

  const rebuildFromQbo = async () => {
    if (!confirm('This will delete all receipts, stock units, and QBO orders, then reprocess from staged data. Continue?')) return;
    setRebuilding(true);
    try {
      setRebuildPhase('Resetting canonical data...');
      const resetData = await invokeWithAuth<Record<string, unknown>>('admin-data', { action: 'rebuild-from-qbo' });
      if ((resetData as Record<string, unknown>)?.error) throw new Error(String((resetData as Record<string, unknown>).error));

      let totalProcessed = 0;
      for (let i = 0; i < 200; i++) {
        setRebuildPhase(`Processed ${totalProcessed} records...`);
        const d = await invokeWithAuth<Record<string, unknown>>('qbo-process-pending', { batch_size: 50 });
        if ((d as Record<string, unknown>)?.error) throw new Error(String((d as Record<string, unknown>).error));
        const r = (d as Record<string, unknown>).results as Record<string, Record<string, number>> | undefined;
        if (r) {
          totalProcessed += (r.items?.processed ?? 0) + (r.purchases?.processed ?? 0) +
            (r.sales?.processed ?? 0) + (r.refunds?.processed ?? 0) + (r.customers?.processed ?? 0);
        }
        if (!(d as Record<string, unknown>).has_more) break;
      }
      toast.success(`Rebuild complete — ${totalProcessed} records committed`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Rebuild failed');
    } finally {
      setRebuilding(false);
      setRebuildPhase('');
    }
  };

  // ── Render ──

  const Btn = ({ onClick, disabled, busy, children }: {
    onClick: () => void; disabled?: boolean; busy?: boolean; children: React.ReactNode;
  }) => (
    <button
      onClick={onClick}
      disabled={disabled || anyBusy}
      className="px-3 py-1.5 rounded text-xs font-medium border border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-50 transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5"
    >
      {busy && <Loader2 className="h-3 w-3 animate-spin" />}
      {children}
    </button>
  );

  const DangerBtn = ({ onClick, disabled, busy, children }: {
    onClick: () => void; disabled?: boolean; busy?: boolean; children: React.ReactNode;
  }) => (
    <button
      onClick={onClick}
      disabled={disabled || anyBusy}
      className="px-3 py-1.5 rounded text-xs font-medium border border-red-300 bg-red-50 text-red-700 hover:bg-red-100 transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5"
    >
      {busy && <Loader2 className="h-3 w-3 animate-spin" />}
      {children}
    </button>
  );

  if (loading) {
    return (
      <SurfaceCard>
        <SectionHead>QuickBooks Online</SectionHead>
        <p className="text-xs text-zinc-500 py-4">Checking connection...</p>
      </SurfaceCard>
    );
  }

  return (
    <SurfaceCard>
      <div className="flex items-center justify-between">
        <SectionHead>QuickBooks Online</SectionHead>
        <Badge
          label={status?.connected ? 'Connected' : 'Disconnected'}
          color={status?.connected ? '#22C55E' : '#EF4444'}
          small
        />
      </div>

      {!status?.connected ? (
        <div className="mt-3">
          <Btn onClick={connect}>Connect to QuickBooks</Btn>
        </div>
      ) : (
        <div className="mt-3 space-y-4">
          {status.realm_id && (
            <p className="text-[10px] text-zinc-500">
              Realm: <Mono className="text-[10px]">{status.realm_id}</Mono>
            </p>
          )}

          {/* Progress bars */}
          {syncing && (
            <div className="space-y-1">
              <p className="text-[10px] text-zinc-500">Landing purchases {syncLabel}</p>
              <div className="h-1.5 bg-zinc-200 rounded-full overflow-hidden">
                <div className="h-full bg-amber-400 transition-all" style={{ width: `${syncPct}%` }} />
              </div>
              <button onClick={() => { cancelPurchases.current = true; }} className="text-[9px] text-red-500 hover:text-red-700">Stop</button>
            </div>
          )}
          {syncingSales && (
            <div className="space-y-1">
              <p className="text-[10px] text-zinc-500">Landing sales {salesLabel}</p>
              <div className="h-1.5 bg-zinc-200 rounded-full overflow-hidden">
                <div className="h-full bg-amber-400 transition-all" style={{ width: `${salesPct}%` }} />
              </div>
              <button onClick={() => { cancelSales.current = true; }} className="text-[9px] text-red-500 hover:text-red-700">Stop</button>
            </div>
          )}
          {processLabel && <p className="text-[10px] text-zinc-500">{processLabel}</p>}
          {rebuildPhase && <p className="text-[10px] text-zinc-500">{rebuildPhase}</p>}

          {/* Land data */}
          <div>
            <p className="text-[9px] uppercase tracking-wider text-zinc-400 mb-1.5">Land Data</p>
            <div className="flex flex-wrap gap-1.5">
              <Btn onClick={syncPurchases} busy={syncing}>Purchases</Btn>
              <Btn onClick={syncSalesAction} busy={syncingSales}>Sales</Btn>
              <Btn onClick={syncCustomersAction} busy={syncingCustomers}>Customers</Btn>
              <Btn onClick={syncItemsAction} busy={syncingItems}>Items</Btn>
            </div>
          </div>

          {/* Process & Reconcile */}
          <div>
            <p className="text-[9px] uppercase tracking-wider text-zinc-400 mb-1.5">Process & Reconcile</p>
            <div className="flex flex-wrap gap-1.5">
              <Btn onClick={processPending} busy={processing}>Process Pending</Btn>
              <Btn onClick={reconcileStock} busy={reconciling}>Reconcile Stock</Btn>
            </div>
          </div>

          {/* Admin */}
          <div>
            <p className="text-[9px] uppercase tracking-wider text-zinc-400 mb-1.5">Admin</p>
            <div className="flex flex-wrap gap-1.5">
              <DangerBtn onClick={rebuildFromQbo} busy={rebuilding}>Rebuild from QBO</DangerBtn>
              <DangerBtn onClick={disconnect} busy={disconnecting}>Disconnect</DangerBtn>
            </div>
          </div>

          {/* Reconciliation details */}
          {reconcileDetails && reconcileDetails.length > 0 && (
            <div>
              <div className="flex items-center justify-between mb-1">
                <p className="text-xs font-medium text-zinc-700">Stock Discrepancies</p>
                <button onClick={() => setReconcileDetails(null)} className="text-[9px] text-zinc-400 hover:text-zinc-600">Dismiss</button>
              </div>
              <div className="overflow-x-auto rounded border border-zinc-200">
                <table className="w-full text-[11px]">
                  <thead>
                    <tr className="bg-zinc-50">
                      <th className="text-left px-2 py-1 font-medium text-zinc-500">SKU</th>
                      <th className="text-right px-2 py-1 font-medium text-zinc-500">App</th>
                      <th className="text-right px-2 py-1 font-medium text-zinc-500">QBO</th>
                      <th className="text-right px-2 py-1 font-medium text-zinc-500">Diff</th>
                    </tr>
                  </thead>
                  <tbody>
                    {reconcileDetails.map((d, i) => (
                      <tr key={i} className="border-t border-zinc-100">
                        <td className="px-2 py-1"><Mono className="text-[10px]">{String(d.sku_code)}</Mono></td>
                        <td className="text-right px-2 py-1">{String(d.app_qty ?? 0)}</td>
                        <td className="text-right px-2 py-1">{String(d.qbo_qty ?? 0)}</td>
                        <td className="text-right px-2 py-1 font-medium">{String(d.diff ?? 0)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
    </SurfaceCard>
  );
}
