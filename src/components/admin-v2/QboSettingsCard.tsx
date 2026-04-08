// ============================================================
// Admin V2 — QBO Settings Card
// Multi-phase rebuild pipeline: clear → snapshot → wipe → process → replay
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
  const [syncingVendors, setSyncingVendors] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [processLabel, setProcessLabel] = useState('');
  const [reconciling, setReconciling] = useState(false);
  const [reconcileDetails, setReconcileDetails] = useState<Record<string, unknown>[] | null>(null);
  const [reconcileType, setReconcileType] = useState<string>('stock');
  const [reconcilingEntity, setReconcilingEntity] = useState<string | null>(null);
  const [rebuilding, setRebuilding] = useState(false);
  const [rebuildPhase, setRebuildPhase] = useState('');
  const [disconnecting, setDisconnecting] = useState(false);
  const [cleaningGhosts, setCleaningGhosts] = useState(false);
  const [recalcingCost, setRecalcingCost] = useState(false);
  const [retryingPush, setRetryingPush] = useState(false);

  const cancelPurchases = useRef(false);
  const cancelSales = useRef(false);

  const anyBusy = syncing || syncingSales || syncingCustomers || syncingItems || syncingVendors || processing || reconciling || reconcilingEntity !== null || rebuilding || cleaningGhosts || recalcingCost;

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

  const drainPending = async (label?: string, entityType?: string) => {
    setProcessing(true);
    let total = 0;
    try {
      for (let i = 0; i < 200; i++) {
        setProcessLabel(label ? `${label} (${total} committed)` : `Processing... (${total} committed)`);
        const body: Record<string, unknown> = { batch_size: 50 };
        if (entityType) body.entity_type = entityType;
        const data = await invokeWithAuth<Record<string, unknown>>('qbo-process-pending', body);
        if ((data as Record<string, unknown>)?.error) throw new Error(String((data as Record<string, unknown>).error));
        const r = (data as Record<string, unknown>).results as Record<string, Record<string, number>> | undefined;
        if (r) {
          total += (r.items?.processed ?? 0) + (r.purchases?.processed ?? 0) +
            (r.sales?.processed ?? 0) + (r.refunds?.processed ?? 0) + (r.customers?.processed ?? 0) +
            (r.vendors?.processed ?? 0) + (r.deposits?.processed ?? 0);
        }
        if (!(data as Record<string, unknown>).has_more) break;

        // If entity-type-specific, also check if this specific entity has remaining
        if (entityType) {
          const remaining = (data as Record<string, unknown>).remaining as Record<string, number> | undefined;
          if (remaining && (remaining[entityType] ?? 0) === 0) break;
        }
      }
      return total;
    } finally {
      setProcessing(false);
      setProcessLabel('');
    }
  };

  const syncAllMonths = async (fnName: string, label: string, setProgress: (l: string) => void, setPct: (n: number) => void) => {
    const months = generateMonthList();
    let landed = 0;
    for (let i = 0; i < months.length; i++) {
      setProgress(`${label} ${months[i]} (${i + 1}/${months.length})`);
      setPct(((i + 1) / months.length) * 100);
      const d = await invokeWithAuth<Record<string, unknown>>(fnName, { month: months[i] });
      if ((d as Record<string, unknown>)?.error) throw new Error(String((d as Record<string, unknown>).error));
      landed += ((d as Record<string, unknown>).landed as number) ?? ((d as Record<string, unknown>).sales_landed as number) ?? 0;
    }
    return landed;
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
      if (!cancelPurchases.current && landed > 0) {
        const total = await drainPending();
        if (total > 0) toast.success(`Auto-processed ${total} records`);
      }
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
      if (!cancelSales.current && landed > 0) {
        const total = await drainPending();
        if (total > 0) toast.success(`Auto-processed ${total} records`);
      }
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
      if (((d as Record<string, unknown>).landed as number) > 0) {
        const total = await drainPending();
        if (total > 0) toast.success(`Auto-processed ${total} records`);
      }
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
      if (((d as Record<string, unknown>).landed as number) > 0) {
        const total = await drainPending();
        if (total > 0) toast.success(`Auto-processed ${total} records`);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Item sync failed');
    } finally {
      setSyncingItems(false);
    }
  };

  const syncVendorsAction = async () => {
    setSyncingVendors(true);
    try {
      const d = await invokeWithAuth<Record<string, unknown>>('qbo-sync-vendors');
      if ((d as Record<string, unknown>)?.error) throw new Error(String((d as Record<string, unknown>).error));
      toast.success(`Vendors: ${(d as Record<string, unknown>).landed ?? 0} landed, ${(d as Record<string, unknown>).skipped ?? 0} unchanged`);
      if (((d as Record<string, unknown>).landed as number) > 0) {
        const total = await drainPending();
        if (total > 0) toast.success(`Auto-processed ${total} records`);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Vendor sync failed');
    } finally {
      setSyncingVendors(false);
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
      if (r?.vendors?.processed) parts.push(`${r.vendors.processed} vendors`);
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
    setReconcileType('stock');
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

  const reconcileEntity = async (entityAction: string, label: string) => {
    setReconcilingEntity(entityAction);
    setReconcileDetails(null);
    setReconcileType(entityAction);
    try {
      const d = await invokeWithAuth<Record<string, unknown>>('admin-data', { action: entityAction });
      if ((d as Record<string, unknown>)?.error) throw new Error(String((d as Record<string, unknown>).error));
      const summary = [
        `${(d as Record<string, unknown>).total_qbo ?? 0} in QBO`,
        `${(d as Record<string, unknown>).total_app ?? 0} in app`,
        `${(d as Record<string, unknown>).in_sync ?? 0} in sync`,
      ];
      if ((d as Record<string, unknown>).missing_in_app) summary.push(`${(d as Record<string, unknown>).missing_in_app} missing in app`);
      if ((d as Record<string, unknown>).missing_in_qbo) summary.push(`${(d as Record<string, unknown>).missing_in_qbo} missing in QBO`);
      if ((d as Record<string, unknown>).mismatched) summary.push(`${(d as Record<string, unknown>).mismatched} mismatched`);
      if ((d as Record<string, unknown>).auto_fixed) summary.push(`${(d as Record<string, unknown>).auto_fixed} auto-fixed`);
      toast.success(`${label}: ${summary.join(', ')}`);
      if (((d as Record<string, unknown>).details as unknown[])?.length > 0) {
        setReconcileDetails((d as Record<string, unknown>).details as Record<string, unknown>[]);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : `${label} reconciliation failed`);
    } finally {
      setReconcilingEntity(null);
    }
  };


  const rebuildFromQbo = async () => {
    if (!confirm(
      'FULL REBUILD: This will:\n' +
      '1. Clear all QBO landing tables\n' +
      '2. Re-fetch ALL data from QBO live\n' +
      '3. Delete all transactional data\n' +
      '4. Reprocess everything chronologically\n\n' +
      'This may take several minutes. Continue?'
    )) return;

    setRebuilding(true);
    try {
      // ═══ Phase 1: Clear landing tables & wipe canonical data ═══
      setRebuildPhase('Phase 1: Clearing landing tables & canonical data...');
      const resetData = await invokeWithAuth<Record<string, unknown>>('admin-data', { action: 'rebuild-from-qbo' });
      if ((resetData as Record<string, unknown>)?.error) throw new Error(String((resetData as Record<string, unknown>).error));

      // ═══ Phase 2: Re-fetch from QBO live ═══
      // 2a: Tax rates (single call)
      setRebuildPhase('Phase 2a: Syncing tax rates from QBO...');
      await invokeWithAuth('qbo-sync-tax-rates');

      // 2b: Customers (single call)
      setRebuildPhase('Phase 2b: Landing customers from QBO...');
      await invokeWithAuth('qbo-sync-customers');

      // 2c: Items (single call)
      setRebuildPhase('Phase 2c: Landing items from QBO...');
      await invokeWithAuth('qbo-sync-items');

      // 2d: Vendors (single call)
      setRebuildPhase('Phase 2d: Landing vendors from QBO...');
      await invokeWithAuth('qbo-sync-vendors');

      // 2e: Purchases (month by month)
      setRebuildPhase('Phase 2e: Landing purchases from QBO...');
      await syncAllMonths('qbo-sync-purchases', 'Purchases', setRebuildPhase, () => {});

      // 2f: Sales (month by month)
      setRebuildPhase('Phase 2f: Landing sales from QBO...');
      await syncAllMonths('qbo-sync-sales', 'Sales', setRebuildPhase, () => {});

      // 2g: Deposits (single call)
      setRebuildPhase('Phase 2g: Landing deposits from QBO...');
      await invokeWithAuth('qbo-sync-deposits');

      // ═══ Phase 3: Process in strict dependency order ═══
      // 3a: Vendors
      setRebuildPhase('Phase 3a: Processing vendors...');
      await drainPending('Processing vendors', 'vendors');

      // 3b: Customers
      setRebuildPhase('Phase 3b: Processing customers...');
      await drainPending('Processing customers', 'customers');

      // 3c: Items → SKUs
      setRebuildPhase('Phase 3c: Processing items...');
      await drainPending('Processing items', 'items');

      // 3d: Purchases → Receipts → Purchase Batches → Stock Units
      setRebuildPhase('Phase 3d: Processing purchases...');
      const purchasesProcessed = await drainPending('Processing purchases', 'purchases');

      // 3e: Safety check — verify purchases created batches
      setRebuildPhase('Phase 3e: Verifying purchase integrity...');
      const verifyData = await invokeWithAuth<Record<string, unknown>>('qbo-process-pending', { entity_type: 'purchases', batch_size: 1 });
      const purchaseRemaining = ((verifyData as Record<string, unknown>)?.remaining as Record<string, number>)?.purchases ?? 0;
      if (purchaseRemaining > 0) {
        toast.error(`${purchaseRemaining} purchases still pending — stopping before sales`);
        return;
      }

      // 3f: Sales + Refunds
      setRebuildPhase('Phase 3f: Processing sales receipts...');
      await drainPending('Processing sales', 'sales');
      await drainPending('Processing refunds', 'refunds');

      // 3g: Deposits
      setRebuildPhase('Phase 3g: Processing deposits...');
      await drainPending('Processing deposits', 'deposits');

      // ═══ Phase 4: Non-QBO channel data ═══
      // Stripe/eBay orders and payouts cannot be auto-replayed from QBO rebuild.
      // They must be re-imported manually via their respective sync tools
      // (eBay Sync, Stripe Sync) after rebuild completes.
      setRebuildPhase('Phase 4: Skipped — re-import eBay/Stripe data via their sync tools after rebuild');

      toast.success(`Rebuild complete — ${purchasesProcessed}+ records committed from fresh QBO snapshot`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Rebuild failed');
    } finally {
      setRebuilding(false);
      setRebuildPhase('');
    }
  };

  const cleanupGhostUnits = async () => {
    setCleaningGhosts(true);
    try {
      const data = await invokeWithAuth<Record<string, unknown>>('admin-data', { action: 'cleanup-ghost-units' });
      const deleted = (data as any)?.deleted ?? 0;
      const resetCount = (data as any)?.resetCount ?? 0;
      toast.success(`Cleaned up ${deleted} ghost units${resetCount > 0 ? `, reset ${resetCount} errored purchases — run Process Pending next` : ''}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Cleanup failed');
    } finally {
      setCleaningGhosts(false);
    }
  };

  const recalcAvgCost = async () => {
    setRecalcingCost(true);
    try {
      const data = await invokeWithAuth<Record<string, unknown>>('admin-data', { action: 'recalc-avg-cost' });
      toast.success(`Recalculated avg cost on ${(data as any)?.updated ?? 0} SKUs`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Recalc failed');
    } finally {
      setRecalcingCost(false);
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
          {rebuildPhase && (
            <div className="space-y-1">
              <p className="text-[10px] text-amber-600 font-medium">{rebuildPhase}</p>
              <div className="h-1.5 bg-amber-100 rounded-full overflow-hidden">
                <div className="h-full bg-amber-400 animate-pulse" style={{ width: '100%' }} />
              </div>
            </div>
          )}

          {/* Land data */}
          <div>
            <p className="text-[9px] uppercase tracking-wider text-zinc-400 mb-1.5">Land Data</p>
            <div className="flex flex-wrap gap-1.5">
              <Btn onClick={syncPurchases} busy={syncing}>Purchases</Btn>
              <Btn onClick={syncSalesAction} busy={syncingSales}>Sales</Btn>
              <Btn onClick={syncCustomersAction} busy={syncingCustomers}>Customers</Btn>
              <Btn onClick={syncItemsAction} busy={syncingItems}>Items</Btn>
              <Btn onClick={syncVendorsAction} busy={syncingVendors}>Vendors</Btn>
            </div>
          </div>

          {/* Process & Reconcile */}
          <div>
            <p className="text-[9px] uppercase tracking-wider text-zinc-400 mb-1.5">Process & Reconcile</p>
            <div className="flex flex-wrap gap-1.5">
              <Btn onClick={processPending} busy={processing}>Process Pending</Btn>
              <Btn onClick={reconcileStock} busy={reconciling}>Reconcile Stock</Btn>
              <Btn onClick={() => reconcileEntity('reconcile-purchases', 'Purchases')} busy={reconcilingEntity === 'reconcile-purchases'}>Reconcile Purchases</Btn>
              <Btn onClick={() => reconcileEntity('reconcile-sales', 'Sales')} busy={reconcilingEntity === 'reconcile-sales'}>Reconcile Sales</Btn>
              <Btn onClick={() => reconcileEntity('reconcile-customers', 'Customers')} busy={reconcilingEntity === 'reconcile-customers'}>Reconcile Customers</Btn>
              <Btn onClick={() => reconcileEntity('reconcile-items', 'Items')} busy={reconcilingEntity === 'reconcile-items'}>Reconcile Items</Btn>
              <Btn onClick={() => reconcileEntity('reconcile-vendors', 'Vendors')} busy={reconcilingEntity === 'reconcile-vendors'}>Reconcile Vendors</Btn>
            </div>
          </div>

          {/* Data Cleanup */}
          <div>
            <p className="text-[9px] uppercase tracking-wider text-zinc-400 mb-1.5">Data Cleanup</p>
            <div className="flex flex-wrap gap-1.5">
              <Btn onClick={cleanupGhostUnits} busy={cleaningGhosts}>Cleanup Ghost Units</Btn>
              <Btn onClick={recalcAvgCost} busy={recalcingCost}>Recalc Avg Cost</Btn>
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
                <p className="text-xs font-medium text-zinc-700">
                  {reconcileType === 'stock' ? 'Stock Discrepancies' : `${reconcileType.replace('reconcile-', '').replace(/^\w/, (c: string) => c.toUpperCase())} Discrepancies`}
                </p>
                <button onClick={() => setReconcileDetails(null)} className="text-[9px] text-zinc-400 hover:text-zinc-600">dismiss</button>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-[10px]">
                  <thead>
                    <tr className="border-b border-zinc-200">
                      {reconcileType === 'stock' ? (
                        <>
                          <th className="text-left py-1 pr-2 text-zinc-500 font-medium">SKU</th>
                          <th className="text-right py-1 px-2 text-zinc-500 font-medium">QBO</th>
                          <th className="text-right py-1 px-2 text-zinc-500 font-medium">App</th>
                          <th className="text-right py-1 px-2 text-zinc-500 font-medium">Diff</th>
                          <th className="text-left py-1 pl-2 text-zinc-500 font-medium">Action</th>
                        </>
                      ) : (
                        <>
                          <th className="text-left py-1 pr-2 text-zinc-500 font-medium">Entity</th>
                          <th className="text-left py-1 px-2 text-zinc-500 font-medium">QBO ID</th>
                          <th className="text-left py-1 px-2 text-zinc-500 font-medium">Issue</th>
                          <th className="text-left py-1 pl-2 text-zinc-500 font-medium">Action</th>
                        </>
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {reconcileDetails.slice(0, 30).map((d, i) => (
                      <tr key={i} className="border-b border-zinc-100">
                        {reconcileType === 'stock' ? (
                          <>
                            <td className="py-0.5 pr-2"><Mono className="text-[10px]">{String(d.sku_code)}</Mono></td>
                            <td className="text-right py-0.5 px-2">{String(d.qbo_qty)}</td>
                            <td className="text-right py-0.5 px-2">{String(d.app_qty)}</td>
                            <td className="text-right py-0.5 px-2">{String(d.diff)}</td>
                            <td className="py-0.5 pl-2 text-zinc-500">{String(d.action)}</td>
                          </>
                        ) : (
                          <>
                            <td className="py-0.5 pr-2"><Mono className="text-[10px]">{String(d.entity)}</Mono></td>
                            <td className="py-0.5 px-2"><Mono className="text-[10px]">{String(d.qbo_id)}</Mono></td>
                            <td className="py-0.5 px-2 text-zinc-600 max-w-[200px] truncate">{String(d.issue)}</td>
                            <td className="py-0.5 pl-2 text-zinc-500">{String(d.action)}</td>
                          </>
                        )}
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
