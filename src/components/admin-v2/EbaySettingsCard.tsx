// ============================================================
// Admin V2 — eBay Settings Card
// Connect/disconnect, sync orders, push stock, notifications.
// Ported from v1 EbaySettingsPanel using v2 design primitives.
// ============================================================

import { useState } from 'react';
import { SurfaceCard, SectionHead, Badge, Mono } from './ui-primitives';
import { invokeWithAuth } from '@/lib/invokeWithAuth';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';

type EbayStatus = { connected: boolean; last_updated?: string };

interface SubResult {
  subscriptionId?: string;
  topicId?: string;
  topic?: string;
  status?: string;
  error?: string;
  reason?: string;
  testStatus?: 'passed' | 'failed' | 'skipped';
}

export function EbaySettingsCard() {
  const [status, setStatus] = useState<EbayStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null); // tracks which action is running
  const [subscriptions, setSubscriptions] = useState<SubResult[] | null>(null);
  const [diagReport, setDiagReport] = useState<{ issues?: string[]; notificationCount?: number } | null>(null);

  // Fetch on mount
  useState(() => {
    (async () => {
      try {
        const data = await invokeWithAuth<EbayStatus>('ebay-auth', { action: 'status' });
        setStatus(data && !('error' in data) ? data : { connected: false });
      } catch {
        setStatus({ connected: false });
      } finally {
        setLoading(false);
      }
    })();
  });

  const run = async (label: string, fn: () => Promise<void>) => {
    setBusy(label);
    try {
      await fn();
    } finally {
      setBusy(null);
    }
  };

  const connect = () => run('connect', async () => {
    const d = await invokeWithAuth<Record<string, unknown>>('ebay-auth', { action: 'authorize_url' });
    if (d?.error) throw new Error(String(d.error));
    window.location.href = d.url as string;
  });

  const disconnect = () => run('disconnect', async () => {
    await invokeWithAuth('ebay-auth', { action: 'disconnect' });
    setStatus({ connected: false });
    toast.success('Disconnected from eBay');
  });

  const syncOrders = () => run('orders', async () => {
    const d = await invokeWithAuth<Record<string, unknown>>('ebay-sync', { action: 'sync_orders' });
    if ((d as Record<string, unknown>)?.error) throw new Error(String((d as Record<string, unknown>).error));
    toast.success(`Orders synced: ${(d as Record<string, unknown>).orders_synced ?? 0}, enriched: ${(d as Record<string, unknown>).orders_enriched ?? 0}`);
  });

  const syncInventory = () => run('inventory', async () => {
    const d = await invokeWithAuth<Record<string, unknown>>('ebay-sync', { action: 'sync_inventory' });
    if ((d as Record<string, unknown>)?.error) throw new Error(String((d as Record<string, unknown>).error));
    toast.success(`${(d as Record<string, unknown>).inventory_synced ?? 0} listings synced`);
  });

  const pushStock = () => run('push', async () => {
    const d = await invokeWithAuth<Record<string, unknown>>('ebay-sync', { action: 'push_stock' });
    if ((d as Record<string, unknown>)?.error) throw new Error(String((d as Record<string, unknown>).error));
    toast.success(`${(d as Record<string, unknown>).stock_pushed ?? 0} SKUs pushed to eBay`);
  });

  const syncListings = () => run('listings', async () => {
    const d = await invokeWithAuth<Record<string, unknown>>('ebay-sync', { action: 'sync_listings' });
    if ((d as Record<string, unknown>)?.error) throw new Error(String((d as Record<string, unknown>).error));
    toast.success(`Matched: ${(d as Record<string, unknown>).products_matched ?? 0}, images: ${(d as Record<string, unknown>).images_downloaded ?? 0}`);
  });

  const setupNotifications = () => run('notifs', async () => {
    const d = await invokeWithAuth<Record<string, unknown>>('ebay-sync', { action: 'setup_notifications' });
    if ((d as Record<string, unknown>)?.error) throw new Error(String((d as Record<string, unknown>).error));
    const subs = ((d as Record<string, unknown>).subscriptions as SubResult[]) ?? [];
    setSubscriptions(subs);
    toast.success(`${subs.length} topic(s) configured`);
  });

  const viewSubscriptions = () => run('view-subs', async () => {
    const d = await invokeWithAuth<Record<string, unknown>>('ebay-sync', { action: 'get_subscriptions' });
    setSubscriptions(((d as Record<string, unknown>)?.subscriptions as SubResult[]) ?? []);
  });

  const testSubscriptions = () => run('test-subs', async () => {
    const d = await invokeWithAuth<Record<string, unknown>>('ebay-sync', { action: 'test_subscriptions' });
    if ((d as Record<string, unknown>)?.error) throw new Error(String((d as Record<string, unknown>).error));
    const results = ((d as Record<string, unknown>).results as SubResult[]) ?? [];
    setSubscriptions(results.map(r => ({ ...r, testStatus: r.status as SubResult['testStatus'] })));
    const passed = results.filter(r => r.status === 'passed').length;
    const failed = results.filter(r => r.status === 'failed').length;
    if (failed > 0) toast.error(`${passed} passed, ${failed} failed`);
    else toast.success(`All ${passed} tests passed`);
  });

  const diagnose = () => run('diagnose', async () => {
    const d = await invokeWithAuth<Record<string, unknown>>('ebay-sync', { action: 'diagnose_notifications' });
    setDiagReport(d as { issues?: string[]; notificationCount?: number });
    const issues = ((d as Record<string, unknown>).issues as string[]) ?? [];
    if (issues.length > 0) toast.error(`${issues.length} issue(s) found`);
    else toast.success('No issues detected');
  });

  // ── Render ──

  const Btn = ({ onClick, label, busyKey }: { onClick: () => void; label: string; busyKey: string }) => (
    <button
      onClick={onClick}
      disabled={!!busy}
      className="px-3 py-1.5 rounded text-xs font-medium border border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-50 transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5"
    >
      {busy === busyKey && <Loader2 className="h-3 w-3 animate-spin" />}
      {label}
    </button>
  );

  if (loading) {
    return (
      <SurfaceCard>
        <SectionHead>eBay</SectionHead>
        <p className="text-xs text-zinc-500 py-4">Checking connection...</p>
      </SurfaceCard>
    );
  }

  return (
    <SurfaceCard>
      <div className="flex items-center justify-between">
        <SectionHead>eBay</SectionHead>
        <Badge
          label={status?.connected ? 'Connected' : 'Disconnected'}
          color={status?.connected ? '#22C55E' : '#EF4444'}
          small
        />
      </div>

      {!status?.connected ? (
        <div className="mt-3">
          <button
            onClick={connect}
            disabled={!!busy}
            className="px-3 py-1.5 rounded text-xs font-medium border border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-50 transition-colors"
          >
            Connect to eBay
          </button>
        </div>
      ) : (
        <div className="mt-3 space-y-4">
          {status.last_updated && (
            <p className="text-[10px] text-zinc-500">
              Token updated: {new Date(status.last_updated).toLocaleString()}
            </p>
          )}

          {/* Sync actions */}
          <div>
            <p className="text-[9px] uppercase tracking-wider text-zinc-400 mb-1.5">Sync</p>
            <div className="flex flex-wrap gap-1.5">
              <Btn onClick={syncOrders} label="Orders" busyKey="orders" />
              <Btn onClick={syncInventory} label="Inventory" busyKey="inventory" />
              <Btn onClick={pushStock} label="Push Stock" busyKey="push" />
              <Btn onClick={syncListings} label="Sync Listings" busyKey="listings" />
            </div>
          </div>

          {/* Notifications */}
          <div>
            <p className="text-[9px] uppercase tracking-wider text-zinc-400 mb-1.5">Notifications</p>
            <div className="flex flex-wrap gap-1.5">
              <Btn onClick={setupNotifications} label="Setup" busyKey="notifs" />
              <Btn onClick={viewSubscriptions} label="View Subs" busyKey="view-subs" />
              <Btn onClick={testSubscriptions} label="Test Subs" busyKey="test-subs" />
              <Btn onClick={diagnose} label="Diagnose" busyKey="diagnose" />
            </div>
          </div>

          {/* Admin */}
          <div>
            <p className="text-[9px] uppercase tracking-wider text-zinc-400 mb-1.5">Admin</p>
            <button
              onClick={disconnect}
              disabled={!!busy}
              className="px-3 py-1.5 rounded text-xs font-medium border border-red-300 bg-red-50 text-red-700 hover:bg-red-100 transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5"
            >
              {busy === 'disconnect' && <Loader2 className="h-3 w-3 animate-spin" />}
              Disconnect
            </button>
          </div>

          {/* Subscription results */}
          {subscriptions && subscriptions.length > 0 && (
            <div>
              <p className="text-xs font-medium text-zinc-700 mb-1">Subscriptions</p>
              <div className="flex flex-wrap gap-1">
                {subscriptions.map((sub, i) => {
                  const topic = sub.topicId || sub.topic || 'Unknown';
                  const color = sub.testStatus === 'passed' || sub.status === 'ENABLED' ? '#22C55E'
                    : sub.testStatus === 'failed' || sub.status === 'error' ? '#EF4444'
                    : '#71717A';
                  return (
                    <Badge
                      key={sub.subscriptionId || i}
                      label={topic}
                      color={color}
                      small
                    />
                  );
                })}
              </div>
              {subscriptions.filter(s => s.testStatus === 'failed').map((s, i) => (
                <p key={i} className="text-[10px] text-red-500 mt-1">
                  {s.topicId || s.topic}: {s.error || 'Failed'}
                </p>
              ))}
            </div>
          )}

          {/* Diagnostic report */}
          {diagReport && (
            <div>
              <p className="text-xs font-medium text-zinc-700 mb-1">Diagnostics</p>
              {(diagReport.issues?.length ?? 0) === 0 ? (
                <p className="text-[10px] text-green-600">No issues detected</p>
              ) : (
                diagReport.issues!.map((issue, i) => (
                  <p key={i} className="text-[10px] text-red-500">{issue}</p>
                ))
              )}
              <p className="text-[10px] text-zinc-500 mt-0.5">
                Notifications received: <Mono className="text-[10px]">{diagReport.notificationCount ?? '?'}</Mono>
              </p>
            </div>
          )}
        </div>
      )}
    </SurfaceCard>
  );
}
