import { useEffect, useMemo, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { invokeWithAuth } from '@/lib/invokeWithAuth';
import { SurfaceCard, SectionHead, Badge, Mono } from './ui-primitives';

type GmcStatus = {
  connected: boolean;
  expired?: boolean | null;
  merchant_id?: string | null;
  data_source?: string | null;
  token_expires_at?: string | null;
  last_updated?: string | null;
};

type PublishHistoryRow = {
  id: string;
  createdAt: string;
  queued: number;
  skipped: number;
  errors: number;
  errorDetails: unknown[];
  skippedDetails: unknown[];
};

const PUBLISH_HISTORY_KEY = 'gmc_publish_history_v1';

export function GmcSettingsCard() {
  const [status, setStatus] = useState<GmcStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [merchantId, setMerchantId] = useState('');
  const [dataSource, setDataSource] = useState('');
  const [lastPublishResult, setLastPublishResult] = useState<Record<string, unknown> | null>(null);
  const [history, setHistory] = useState<PublishHistoryRow[]>([]);
  const [query, setQuery] = useState('');
  const [sortBy, setSortBy] = useState<'createdAt' | 'queued' | 'errors'>('createdAt');

  useEffect(() => {
    const stored = localStorage.getItem(PUBLISH_HISTORY_KEY);
    if (!stored) return;
    try { setHistory(JSON.parse(stored) as PublishHistoryRow[]); } catch { setHistory([]); }
  }, []);

  useEffect(() => {
    localStorage.setItem(PUBLISH_HISTORY_KEY, JSON.stringify(history.slice(0, 50)));
  }, [history]);

  const loadStatus = async () => {
    const data = await invokeWithAuth<GmcStatus>('gmc-auth', { action: 'status' });
    const next = data && !('error' in data) ? data : { connected: false };
    setStatus(next);
    setMerchantId(next.merchant_id ?? '');
    setDataSource(next.data_source ?? '');
  };

  useEffect(() => {
    (async () => {
      try { await loadStatus(); } catch { setStatus({ connected: false }); } finally { setLoading(false); }
    })();
  }, []);

  const run = async (label: string, fn: () => Promise<void>) => {
    setBusy(label);
    try { await fn(); } catch (error) { toast.error(error instanceof Error ? error.message : 'Request failed'); } finally { setBusy(null); }
  };

  const publishRows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = history.filter((row) => !q || row.id.toLowerCase().includes(q) || row.createdAt.toLowerCase().includes(q) || String(row.errors).includes(q));
    return filtered.sort((a, b) => {
      if (sortBy === 'createdAt') return b.createdAt.localeCompare(a.createdAt);
      if (sortBy === 'queued') return b.queued - a.queued;
      return b.errors - a.errors;
    });
  }, [history, query, sortBy]);

  const saveConfig = () => run('save', async () => {
    if (!merchantId.trim()) throw new Error('Merchant ID is required');
    await invokeWithAuth('gmc-auth', { action: 'set_config', merchant_id: merchantId.trim(), data_source: dataSource.trim() || null });
    toast.success('Google Merchant config saved');
    await loadStatus();
  });

  const connect = () => run('connect', async () => {
    if (!merchantId.trim()) throw new Error('Enter Merchant ID first');
    localStorage.setItem('gmc_merchant_id', merchantId.trim());
    localStorage.setItem('gmc_data_source', dataSource.trim());
    const d = await invokeWithAuth<{ url: string }>('gmc-auth', { action: 'authorize_url' });
    window.location.href = d.url;
  });

  const disconnect = () => run('disconnect', async () => {
    await invokeWithAuth('gmc-auth', { action: 'disconnect' });
    toast.success('Disconnected from Google Merchant Centre');
    await loadStatus();
  });

  const publishAll = () => run('publish', async () => {
    const d = await invokeWithAuth<Record<string, unknown>>('gmc-sync', { action: 'publish_all' });
    setLastPublishResult(d);
    const row: PublishHistoryRow = {
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      queued: Number(d?.queued ?? 0),
      skipped: Number(d?.skipped ?? 0),
      errors: Number(d?.errors ?? 0),
      errorDetails: (d?.errorDetails as unknown[]) ?? [],
      skippedDetails: (d?.skippedDetails as unknown[]) ?? [],
    };
    setHistory((current) => [row, ...current].slice(0, 50));
    toast.success(`Queued ${row.queued} products (${row.skipped} skipped, ${row.errors} errors)`);
  });

  const syncStatus = () => run('sync-status', async () => {
    const d = await invokeWithAuth<{ synced?: number }>('gmc-sync', { action: 'sync_status' });
    toast.success(`Synced ${d.synced ?? 0} listing statuses`);
  });

  if (loading) return <SurfaceCard><SectionHead>Google Merchant Centre</SectionHead><p className="text-xs text-zinc-500 py-4">Checking connection...</p></SurfaceCard>;

  return (
    <SurfaceCard>
      <div className="flex items-center justify-between">
        <SectionHead>Google Merchant Centre</SectionHead>
        <Badge label={status?.connected ? 'Connected' : 'Disconnected'} color={status?.connected ? '#22C55E' : '#EF4444'} small />
      </div>
      <div className="mt-3 space-y-3">
        <div className="grid gap-2 md:grid-cols-2">
          <input value={merchantId} onChange={(e) => setMerchantId(e.target.value)} placeholder="Merchant ID" className="h-9 rounded border px-2 text-xs" />
          <input value={dataSource} onChange={(e) => setDataSource(e.target.value)} placeholder="Data Source (optional)" className="h-9 rounded border px-2 text-xs" />
        </div>
        <div className="flex flex-wrap gap-1.5">
          <button onClick={saveConfig} disabled={!!busy} className="px-3 py-1.5 rounded text-xs font-medium border">{busy === 'save' && <Loader2 className="inline h-3 w-3 mr-1 animate-spin" />}Save Config</button>
          <button onClick={connect} disabled={!!busy} className="px-3 py-1.5 rounded text-xs font-medium border">{busy === 'connect' && <Loader2 className="inline h-3 w-3 mr-1 animate-spin" />}Connect</button>
          <button onClick={publishAll} disabled={!status?.connected || !!busy} className="px-3 py-1.5 rounded text-xs font-medium border">Publish All</button>
          <button onClick={syncStatus} disabled={!status?.connected || !!busy} className="px-3 py-1.5 rounded text-xs font-medium border">Sync Status</button>
          <button onClick={disconnect} disabled={!status?.connected || !!busy} className="px-3 py-1.5 rounded text-xs font-medium border border-red-300 text-red-700">Disconnect</button>
        </div>

        <div className="rounded border p-2 text-xs space-y-2">
          <div className="flex items-center justify-between gap-2">
            <div className="font-medium">Publish history</div>
            <div className="flex gap-2">
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Filter" className="h-8 rounded border px-2" />
              <select value={sortBy} onChange={(e) => setSortBy(e.target.value as 'createdAt'|'queued'|'errors')} className="h-8 rounded border px-2">
                <option value="createdAt">Newest</option>
                <option value="queued">Most queued</option>
                <option value="errors">Most errors</option>
              </select>
            </div>
          </div>
          <table className="w-full text-left text-xs">
            <thead><tr><th>When</th><th>Queued</th><th>Skipped</th><th>Errors</th></tr></thead>
            <tbody>
              {publishRows.map((row) => <tr key={row.id} className="border-t"><td>{new Date(row.createdAt).toLocaleString()}</td><td><Mono>{row.queued}</Mono></td><td><Mono>{row.skipped}</Mono></td><td><Mono>{row.errors}</Mono></td></tr>)}
              {publishRows.length === 0 && <tr><td colSpan={4} className="py-3 text-zinc-500">No publish events.</td></tr>}
            </tbody>
          </table>
        </div>

        {lastPublishResult && (
          <div className="rounded border p-2 text-xs space-y-2">
            <div className="font-medium">Last publish diagnostics</div>
            <div className="grid gap-1 sm:grid-cols-3">
              <div>Queued: <Mono>{String(lastPublishResult.queued ?? 0)}</Mono></div>
              <div>Skipped: <Mono>{String(lastPublishResult.skipped ?? 0)}</Mono></div>
              <div>Errors: <Mono>{String(lastPublishResult.errors ?? 0)}</Mono></div>
            </div>
          </div>
        )}
      </div>
    </SurfaceCard>
  );
}
