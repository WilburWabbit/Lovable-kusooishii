// ============================================================
// Admin V2 — QBO Settings Card
// Land QBO data, process staging, review drift, and queue posting work.
// ============================================================

import { useEffect, useState, useRef } from 'react';
import { SurfaceCard, SectionHead, Badge, Mono } from './ui-primitives';
import { invokeWithAuth } from '@/lib/invokeWithAuth';
import { supabase } from '@/integrations/supabase/client';
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

type QboRefreshDriftRow = {
  id: string;
  qboRefreshRunId: string;
  driftType: string;
  severity: string;
  status: string;
  qboEntityType: string;
  qboEntityId: string | null;
  qboDocNumber: string | null;
  localEntityType: string | null;
  localEntityId: string | null;
  localReference: string | null;
  appReference: string | null;
  targetRoute: string | null;
  recommendedAction: string | null;
  createdAt: string;
  refreshStatus: string | null;
  refreshStartedAt: string | null;
  refreshCompletedAt: string | null;
};

type QboRefreshRunResponse = {
  success?: boolean;
  run_id?: string;
  status?: string;
  total_steps?: number;
  completed_steps?: number;
  progress_pct?: number;
  next_step_label?: string | null;
  last_step_label?: string | null;
  drift_rows_and_cases?: number;
  error?: string | null;
};

function optionalString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function mapQboRefreshDriftRow(row: Record<string, unknown>): QboRefreshDriftRow {
  return {
    id: String(row.id),
    qboRefreshRunId: String(row.qbo_refresh_run_id),
    driftType: String(row.drift_type ?? 'unknown'),
    severity: String(row.severity ?? 'medium'),
    status: String(row.status ?? 'open'),
    qboEntityType: String(row.qbo_entity_type ?? 'qbo_entity'),
    qboEntityId: optionalString(row.qbo_entity_id),
    qboDocNumber: optionalString(row.qbo_doc_number),
    localEntityType: optionalString(row.local_entity_type),
    localEntityId: optionalString(row.local_entity_id),
    localReference: optionalString(row.local_reference),
    appReference: optionalString(row.app_reference),
    targetRoute: optionalString(row.target_route),
    recommendedAction: optionalString(row.recommended_action),
    createdAt: String(row.created_at ?? ''),
    refreshStatus: optionalString(row.refresh_status),
    refreshStartedAt: optionalString(row.refresh_started_at),
    refreshCompletedAt: optionalString(row.refresh_completed_at),
  };
}

function formatLabel(value: string): string {
  return value
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatDateTime(value: string | null): string {
  if (!value) return '—';
  return new Date(value).toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

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
  const [refreshingQboDryRun, setRefreshingQboDryRun] = useState(false);
  const [qboDryRunPhase, setQboDryRunPhase] = useState('');
  const [qboDryRunPct, setQboDryRunPct] = useState(0);
  const [qboDryRunRunId, setQboDryRunRunId] = useState<string | null>(null);
  const [qboRefreshDriftRows, setQboRefreshDriftRows] = useState<QboRefreshDriftRow[]>([]);
  const [qboRefreshLoading, setQboRefreshLoading] = useState(false);
  const [qboRefreshApplying, setQboRefreshApplying] = useState(false);
  const [qboRefreshActionId, setQboRefreshActionId] = useState<string | null>(null);
  const [disconnecting, setDisconnecting] = useState(false);
  const [cleaningGhosts, setCleaningGhosts] = useState(false);
  const [recalcingCost, setRecalcingCost] = useState(false);
  const [retryingPush, setRetryingPush] = useState(false);
  const [syncingDeposits, setSyncingDeposits] = useState(false);
  const [accountsLoading, setAccountsLoading] = useState(false);
  const [accountsSaving, setAccountsSaving] = useState(false);
  const [accountList, setAccountList] = useState<Array<{ id: string; name: string; type: string; subType: string | null }>>([]);
  const [accountMappings, setAccountMappings] = useState<Record<string, { account_id: string; account_name: string | null; account_type: string | null }>>({});
  const [accountsLoaded, setAccountsLoaded] = useState(false);

  const cancelPurchases = useRef(false);
  const cancelSales = useRef(false);

  const anyBusy = syncing || syncingSales || syncingCustomers || syncingItems || syncingVendors || processing || reconciling || reconcilingEntity !== null || refreshingQboDryRun || qboRefreshLoading || qboRefreshApplying || qboRefreshActionId !== null || cleaningGhosts || recalcingCost || retryingPush || syncingDeposits || accountsLoading || accountsSaving;

  // ── Fetch status on mount ──
  useEffect(() => {
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
  }, []);

  const loadQboRefreshDrift = async () => {
    setQboRefreshLoading(true);
    try {
      const { data, error } = await supabase
        .from('v_qbo_refresh_drift' as never)
        .select('*')
        .in('status' as never, ['open', 'approved', 'applied', 'ignored'])
        .order('created_at' as never, { ascending: false })
        .limit(100);

      if (error) throw error;
      setQboRefreshDriftRows(((data ?? []) as unknown as Record<string, unknown>[]).map(mapQboRefreshDriftRow));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load QBO refresh drift');
    } finally {
      setQboRefreshLoading(false);
    }
  };

  useEffect(() => {
    if (!status?.connected) return;
    void loadQboRefreshDrift();
  }, [status?.connected]);

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

  const retryFailedPush = async () => {
    setRetryingPush(true);
    try {
      const resetData = await invokeWithAuth<{ reset: number }>('admin-data', { action: 'retry-failed-qbo-push' });
      const resetCount = resetData?.reset ?? 0;
      if (resetCount > 0) {
        toast.success(`Reset ${resetCount} failed order(s) — processing...`);
      }
      const d = await invokeWithAuth<Record<string, unknown>>('accounting-posting-intents-process', { batchSize: 50 });
      const processed = Number((d as Record<string, unknown>)?.processed ?? 0);
      if (processed === 0 && resetCount === 0) {
        toast.info('No QBO posting intents pending');
      } else {
        toast.success(`Retry queued: ${resetCount} order(s) reset, ${processed} posting intent(s) processed`);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Retry failed push failed');
    } finally {
      setRetryingPush(false);
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


  const runQboDryRunRefresh = async () => {
    if (!confirm(
      'QBO DRY-RUN REFRESH: This will run as a resumable chunked job:\n' +
      '1. Land a fresh QBO snapshot into staging tables, one bounded step at a time\n' +
      '2. Compare QBO references and DocNumbers against app records\n' +
      '3. Create drift cases for review\n\n' +
      'It will not delete or rewrite canonical app data, website listings, eBay listings, prices, listing IDs, or outbound commands. Continue?'
    )) return;

    setRefreshingQboDryRun(true);
    setQboDryRunPct(0);
    setQboDryRunRunId(null);
    try {
      setQboDryRunPhase('Creating resumable QBO dry-run...');
      let data = await invokeWithAuth<QboRefreshRunResponse>('qbo-wholesale-refresh', {
        action: 'start',
        mode: 'dry_run',
        monthsBack: 36,
      });

      const runId = data.run_id;
      if (!runId) throw new Error('QBO dry-run refresh did not return a run ID');
      setQboDryRunRunId(runId);

      const maxSteps = Math.max(Number(data.total_steps ?? 0) + 5, 10);
      for (let i = 0; i < maxSteps; i += 1) {
        if (data.status === 'completed') break;
        if (data.status === 'failed' || data.success === false) {
          throw new Error(data.error ?? 'QBO dry-run refresh failed');
        }

        const totalSteps = Number(data.total_steps ?? 0);
        const completedSteps = Number(data.completed_steps ?? 0);
        const nextLabel = data.next_step_label ?? `Step ${completedSteps + 1}`;
        setQboDryRunPhase(
          totalSteps > 0
            ? `Step ${completedSteps + 1}/${totalSteps}: ${nextLabel}`
            : nextLabel,
        );
        setQboDryRunPct(Number(data.progress_pct ?? 0));

        data = await invokeWithAuth<QboRefreshRunResponse>('qbo-wholesale-refresh', {
          action: 'step',
          run_id: runId,
          mode: 'dry_run',
        });
        setQboDryRunPct(Number(data.progress_pct ?? 0));
      }

      if (data.status !== 'completed') {
        throw new Error('QBO dry-run refresh did not complete before the local step guard stopped it. Re-run the dry-run to resume safely.');
      }

      const driftRows = Number(data.drift_rows_and_cases ?? 0);
      toast.success(`QBO dry-run refresh complete — ${driftRows} drift row/case action(s) created`);
      await loadQboRefreshDrift();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'QBO dry-run refresh failed');
    } finally {
      setRefreshingQboDryRun(false);
      setQboDryRunPhase('');
      setQboDryRunPct(0);
      setQboDryRunRunId(null);
    }
  };

  const approveQboRefreshDrift = async (driftId: string) => {
    setQboRefreshActionId(driftId);
    try {
      const { error } = await supabase.rpc('approve_qbo_refresh_drift' as never, {
        p_drift_id: driftId,
      } as never);
      if (error) throw error;
      toast.success('QBO drift approved for apply');
      await loadQboRefreshDrift();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'QBO drift approval failed');
    } finally {
      setQboRefreshActionId(null);
    }
  };

  const ignoreQboRefreshDrift = async (driftId: string) => {
    setQboRefreshActionId(driftId);
    try {
      const { error } = await supabase
        .from('qbo_refresh_drift' as never)
        .update({ status: 'ignored' } as never)
        .eq('id' as never, driftId);
      if (error) throw error;
      toast.success('QBO drift ignored');
      await loadQboRefreshDrift();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to ignore QBO drift');
    } finally {
      setQboRefreshActionId(null);
    }
  };

  const applyApprovedQboRefreshDrift = async () => {
    const approvedCount = qboRefreshDriftRows.filter((row) => row.status === 'approved').length;
    if (approvedCount === 0) {
      toast.info('No approved QBO drift rows to apply');
      return;
    }
    if (!confirm(
      `Apply ${approvedCount} approved QBO drift update(s)?\n\n` +
      'This only updates approved QBO references and DocNumbers. It does not rewrite website listings, eBay listings, prices, listing IDs, or outbound commands.'
    )) return;

    setQboRefreshApplying(true);
    try {
      const { data, error } = await supabase.rpc('apply_approved_qbo_refresh_drift' as never, {
        p_run_id: null,
      } as never);
      if (error) throw error;
      const result = data as unknown as Record<string, unknown> | null;
      toast.success(`Applied ${Number(result?.applied ?? approvedCount)} approved QBO drift update(s)`);
      await loadQboRefreshDrift();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to apply approved QBO drift');
    } finally {
      setQboRefreshApplying(false);
    }
  };

  const cleanupGhostUnits = async () => {
    setCleaningGhosts(true);
    try {
      const data = await invokeWithAuth<Record<string, unknown>>('admin-data', { action: 'cleanup-ghost-units' });
      const deleted = Number(data?.deleted ?? 0);
      const releasedLines = Number(data?.releasedLines ?? 0);
      const resetCount = Number(data?.resetCount ?? 0);
      toast.success(`Cleaned up ${deleted} ghost units${releasedLines > 0 ? `, released ${releasedLines} sale lines` : ''}${resetCount > 0 ? `, reset ${resetCount} errored purchases — run Process Pending next` : ''}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Cleanup failed');
    } finally {
      setCleaningGhosts(false);
    }
  };

  const syncDepositsAction = async () => {
    setSyncingDeposits(true);
    try {
      const landRes = await invokeWithAuth<Record<string, unknown>>('qbo-sync-deposits');
      if ((landRes as Record<string, unknown>)?.error) throw new Error(String((landRes as Record<string, unknown>).error));
      const landed = (landRes as Record<string, unknown>).landed ?? 0;
      const skipped = (landRes as Record<string, unknown>).skipped ?? 0;
      toast.info(`Landed ${landed} deposits (${skipped} unchanged)`);
      if ((landed as number) > 0) {
        const total = await drainPending('Processing deposits', 'deposits');
        if (total > 0) toast.success(`Processed ${total} deposit records`);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Deposit sync failed');
    } finally {
      setSyncingDeposits(false);
    }
  };

  const recalcAvgCost = async () => {
    setRecalcingCost(true);
    try {
      const data = await invokeWithAuth<Record<string, unknown>>('admin-data', { action: 'recalc-avg-cost' });
      toast.success(`Recalculated avg cost on ${Number(data?.updated ?? 0)} SKUs`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Recalc failed');
    } finally {
      setRecalcingCost(false);
    }
  };

  // ── QBO Account Mapping ──

  const ACCOUNT_KEYS: { key: string; label: string; help: string }[] = [
    { key: 'qbo_inventory_asset_account_id', label: 'Inventory Asset', help: 'Where stock value is held on the balance sheet (e.g. "Inventory Asset").' },
    { key: 'qbo_income_account_id', label: 'Sales Income', help: 'Account credited when stock is sold (e.g. "Sales of Product Income").' },
    { key: 'qbo_cogs_account_id', label: 'Cost of Goods Sold', help: 'Account expensed when stock is sold (e.g. "Cost of Goods Sold").' },
    { key: 'qbo_cash_account_id', label: 'Cash / Bank', help: 'Bank or cash account used when pushing new purchase batches as Cash Purchases.' },
    { key: 'qbo_shipping_expense_account_id', label: 'Shipping / Postage Expense', help: 'Expense account for inbound shipping/postage costs on purchase batches (shared cost).' },
    { key: 'qbo_broker_fee_expense_account_id', label: 'Broker / Buying Fee Expense', help: 'Expense account for broker fees, auction fees, or buyer\'s premiums on purchase batches.' },
    { key: 'qbo_other_purchase_expense_account_id', label: 'Other Purchase Expense', help: 'Expense account for miscellaneous shared costs on purchase batches (the "other" line).' },
  ];

  const loadQboAccounts = async () => {
    setAccountsLoading(true);
    try {
      const data = await invokeWithAuth<Record<string, unknown>>('qbo-list-accounts', { action: 'list' });
      if ((data as Record<string, unknown>)?.error) throw new Error(String((data as Record<string, unknown>).error));
      setAccountList(((data as Record<string, unknown>).accounts ?? []) as typeof accountList);
      setAccountMappings(((data as Record<string, unknown>).mappings ?? {}) as typeof accountMappings);
      setAccountsLoaded(true);
      toast.success(`Loaded ${((data as Record<string, unknown>).accounts as unknown[])?.length ?? 0} accounts from QBO`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load QBO accounts');
    } finally {
      setAccountsLoading(false);
    }
  };

  const saveQboAccounts = async () => {
    setAccountsSaving(true);
    try {
      const mappings: Record<string, { account_id: string; account_name?: string; account_type?: string }> = {};
      for (const { key } of ACCOUNT_KEYS) {
        const sel = accountMappings[key];
        if (sel?.account_id) {
          const acc = accountList.find((a) => a.id === sel.account_id);
          mappings[key] = {
            account_id: sel.account_id,
            account_name: acc?.name ?? sel.account_name ?? undefined,
            account_type: acc?.type ?? sel.account_type ?? undefined,
          };
        }
      }
      const data = await invokeWithAuth<Record<string, unknown>>('qbo-list-accounts', { action: 'save', mappings });
      if ((data as Record<string, unknown>)?.error) throw new Error(String((data as Record<string, unknown>).error));
      toast.success(`Saved ${((data as Record<string, unknown>).saved as number) ?? 0} account mapping(s)`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save mappings');
    } finally {
      setAccountsSaving(false);
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

  const qboRefreshCounts = qboRefreshDriftRows.reduce<Record<string, number>>((acc, row) => {
    acc[row.status] = (acc[row.status] ?? 0) + 1;
    return acc;
  }, {});
  const approvedQboRefreshCount = qboRefreshCounts.approved ?? 0;

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
          {qboDryRunPhase && (
            <div className="space-y-1">
              <p className="text-[10px] text-amber-600 font-medium">{qboDryRunPhase}</p>
              {qboDryRunRunId && (
                <p className="text-[9px] text-zinc-400">
                  Run: <Mono className="text-[9px]">{qboDryRunRunId}</Mono>
                </p>
              )}
              <div className="h-1.5 bg-amber-100 rounded-full overflow-hidden">
                <div
                  className="h-full bg-amber-400 transition-all"
                  style={{ width: `${Math.max(4, qboDryRunPct)}%` }}
                />
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
              <Btn onClick={syncDepositsAction} busy={syncingDeposits}>Deposits</Btn>
            </div>
          </div>

          {/* Process & Reconcile */}
          <div>
            <p className="text-[9px] uppercase tracking-wider text-zinc-400 mb-1.5">Process & Reconcile</p>
            <div className="flex flex-wrap gap-1.5">
              <Btn onClick={processPending} busy={processing}>Process Pending</Btn>
              <Btn onClick={retryFailedPush} busy={retryingPush}>Retry Failed Push</Btn>
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

          {/* Account Mapping */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <p className="text-[9px] uppercase tracking-wider text-zinc-400">Account Mapping</p>
              <div className="flex gap-1.5">
                <Btn onClick={loadQboAccounts} busy={accountsLoading}>
                  {accountsLoaded ? 'Reload accounts' : 'Discover accounts'}
                </Btn>
                {accountsLoaded && (
                  <Btn onClick={saveQboAccounts} busy={accountsSaving}>Save mappings</Btn>
                )}
              </div>
            </div>
            <p className="text-[10px] text-zinc-500 mb-2">
              Used when creating QBO Inventory items and Cash Purchases for new purchase batches.
            </p>
            {accountsLoaded ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                {ACCOUNT_KEYS.map(({ key, label, help }) => (
                  <div key={key} className="space-y-0.5">
                    <label className="block text-[10px] font-medium text-zinc-700" title={help}>
                      {label}
                    </label>
                    <select
                      value={accountMappings[key]?.account_id ?? ''}
                      onChange={(e) =>
                        setAccountMappings((prev) => ({
                          ...prev,
                          [key]: {
                            account_id: e.target.value,
                            account_name: accountList.find((a) => a.id === e.target.value)?.name ?? null,
                            account_type: accountList.find((a) => a.id === e.target.value)?.type ?? null,
                          },
                        }))
                      }
                      disabled={anyBusy}
                      className="w-full text-[11px] border border-zinc-300 rounded px-2 py-1 bg-white disabled:opacity-50"
                    >
                      <option value="">— Select account —</option>
                      {accountList.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.name} ({a.type}{a.subType ? ` / ${a.subType}` : ''})
                        </option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-[10px] text-zinc-400 italic">
                Click "Discover accounts" to load the chart of accounts from QuickBooks.
              </p>
            )}
          </div>

          {/* Admin */}
          <div>
            <p className="text-[9px] uppercase tracking-wider text-zinc-400 mb-1.5">Admin</p>
            <div className="flex flex-wrap gap-1.5">
              <DangerBtn onClick={runQboDryRunRefresh} busy={refreshingQboDryRun}>Dry-run QBO refresh</DangerBtn>
              <DangerBtn onClick={disconnect} busy={disconnecting}>Disconnect</DangerBtn>
            </div>
          </div>

          {/* QBO Refresh Drift Review */}
          <div className="rounded-md border border-zinc-200 bg-zinc-50/60 p-3">
            <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
              <div>
                <p className="text-[9px] uppercase tracking-wider text-zinc-400">QBO Refresh Drift Review</p>
                <p className="text-[10px] text-zinc-500 mt-0.5">
                  Review dry-run differences before applying reference and DocNumber repairs.
                </p>
              </div>
              <div className="flex flex-wrap gap-1.5">
                <Btn onClick={loadQboRefreshDrift} busy={qboRefreshLoading}>Reload drift</Btn>
                <Btn
                  onClick={applyApprovedQboRefreshDrift}
                  disabled={approvedQboRefreshCount === 0}
                  busy={qboRefreshApplying}
                >
                  Apply approved ({approvedQboRefreshCount})
                </Btn>
              </div>
            </div>

            <div className="mt-2 flex flex-wrap gap-1.5 text-[10px] text-zinc-500">
              <span>Open: <Mono className="text-[10px]">{String(qboRefreshCounts.open ?? 0)}</Mono></span>
              <span>Approved: <Mono className="text-[10px]">{String(approvedQboRefreshCount)}</Mono></span>
              <span>Applied: <Mono className="text-[10px]">{String(qboRefreshCounts.applied ?? 0)}</Mono></span>
              <span>Ignored: <Mono className="text-[10px]">{String(qboRefreshCounts.ignored ?? 0)}</Mono></span>
            </div>

            {qboRefreshLoading ? (
              <p className="mt-3 text-[10px] text-zinc-500">Loading QBO drift...</p>
            ) : qboRefreshDriftRows.length === 0 ? (
              <p className="mt-3 text-[10px] text-zinc-400 italic">
                No QBO drift has been found yet. Run a dry-run refresh to compare landed QBO records with app references.
              </p>
            ) : (
              <div className="mt-3 max-h-72 overflow-auto rounded border border-zinc-200 bg-white">
                <table className="w-full text-[10px]">
                  <thead className="sticky top-0 bg-white">
                    <tr className="border-b border-zinc-200">
                      <th className="text-left py-1.5 px-2 text-zinc-500 font-medium">Status</th>
                      <th className="text-left py-1.5 px-2 text-zinc-500 font-medium">Drift</th>
                      <th className="text-left py-1.5 px-2 text-zinc-500 font-medium">App Record</th>
                      <th className="text-left py-1.5 px-2 text-zinc-500 font-medium">QBO Reference</th>
                      <th className="text-left py-1.5 px-2 text-zinc-500 font-medium">Recommended Fix</th>
                      <th className="text-right py-1.5 px-2 text-zinc-500 font-medium">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {qboRefreshDriftRows.map((row) => {
                      const statusColor =
                        row.status === 'approved' ? '#3B82F6' :
                        row.status === 'applied' ? '#22C55E' :
                        row.status === 'ignored' ? '#71717A' :
                        row.severity === 'critical' || row.severity === 'high' ? '#EF4444' :
                        '#F59E0B';
                      return (
                        <tr key={row.id} className="border-b border-zinc-100 last:border-b-0">
                          <td className="py-1.5 px-2 align-top">
                            <Badge label={formatLabel(row.status)} color={statusColor} small />
                            <div className="mt-1 text-[9px] text-zinc-400">{formatDateTime(row.createdAt)}</div>
                          </td>
                          <td className="py-1.5 px-2 align-top">
                            <div className="font-medium text-zinc-700">{formatLabel(row.driftType)}</div>
                            <div className="text-[9px] text-zinc-400">{formatLabel(row.severity)}</div>
                          </td>
                          <td className="py-1.5 px-2 align-top">
                            <div className="text-zinc-700">{row.localEntityType ? formatLabel(row.localEntityType) : 'App record'}</div>
                            <Mono className="text-[10px]">{row.appReference ?? row.localReference ?? row.localEntityId ?? '—'}</Mono>
                          </td>
                          <td className="py-1.5 px-2 align-top">
                            <div className="text-zinc-700">{formatLabel(row.qboEntityType)}</div>
                            <Mono className="text-[10px]">{row.qboDocNumber ?? row.qboEntityId ?? '—'}</Mono>
                          </td>
                          <td className="py-1.5 px-2 align-top text-zinc-600 max-w-[240px]">
                            {row.recommendedAction ?? 'Review the QBO value and approve only if it matches the app record.'}
                          </td>
                          <td className="py-1.5 px-2 align-top">
                            <div className="flex justify-end gap-1">
                              {row.targetRoute && (
                                <a
                                  href={row.targetRoute}
                                  className="rounded border border-zinc-300 px-2 py-1 text-[10px] text-zinc-700 hover:bg-zinc-50"
                                >
                                  Open
                                </a>
                              )}
                              <button
                                type="button"
                                onClick={() => approveQboRefreshDrift(row.id)}
                                disabled={anyBusy || row.status !== 'open'}
                                className="rounded border border-blue-300 bg-blue-50 px-2 py-1 text-[10px] text-blue-700 hover:bg-blue-100 disabled:opacity-40"
                              >
                                {qboRefreshActionId === row.id ? 'Working...' : 'Approve'}
                              </button>
                              <button
                                type="button"
                                onClick={() => ignoreQboRefreshDrift(row.id)}
                                disabled={anyBusy || row.status !== 'open'}
                                className="rounded border border-zinc-300 px-2 py-1 text-[10px] text-zinc-600 hover:bg-zinc-50 disabled:opacity-40"
                              >
                                Ignore
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
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
