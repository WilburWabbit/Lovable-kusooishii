import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { invokeWithAuth } from '@/lib/invokeWithAuth';
import { SurfaceCard, SectionHead, Badge } from './ui-primitives';

type GmcStatus = {
  connected: boolean;
  expired?: boolean | null;
  merchant_id?: string | null;
  data_source?: string | null;
  token_expires_at?: string | null;
  last_updated?: string | null;
};

export function GmcSettingsCard() {
  const [status, setStatus] = useState<GmcStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [merchantId, setMerchantId] = useState('');
  const [dataSource, setDataSource] = useState('');

  const loadStatus = async () => {
    const data = await invokeWithAuth<GmcStatus>('gmc-auth', { action: 'status' });
    const next = data && !('error' in data) ? data : { connected: false };
    setStatus(next);
    setMerchantId(next.merchant_id ?? '');
    setDataSource(next.data_source ?? '');
  };

  useEffect(() => {
    (async () => {
      try {
        await loadStatus();
      } catch {
        setStatus({ connected: false });
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const run = async (label: string, fn: () => Promise<void>) => {
    setBusy(label);
    try {
      await fn();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Request failed';
      toast.error(message);
    } finally {
      setBusy(null);
    }
  };

  const saveConfig = () => run('save', async () => {
    if (!merchantId.trim()) throw new Error('Merchant ID is required');
    await invokeWithAuth('gmc-auth', {
      action: 'set_config',
      merchant_id: merchantId.trim(),
      data_source: dataSource.trim() || null,
    });
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
    const d = await invokeWithAuth<{ queued?: number; errors?: number; skipped?: number }>('gmc-sync', { action: 'publish_all' });
    toast.success(`Queued ${d.queued ?? 0} products (${d.skipped ?? 0} skipped, ${d.errors ?? 0} errors)`);
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
      </div>
    </SurfaceCard>
  );
}
