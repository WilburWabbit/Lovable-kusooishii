import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { invokeWithAuth } from '@/lib/invokeWithAuth';
import { Badge, SectionHead, SurfaceCard } from './ui-primitives';

type StripeModeStatus = {
  stripe_test_mode: boolean;
};

export function StripeSettingsCard() {
  const [status, setStatus] = useState<StripeModeStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const data = await invokeWithAuth<StripeModeStatus>('admin-data', { action: 'get-stripe-test-mode' });
        setStatus(data);
      } catch {
        setStatus({ stripe_test_mode: false });
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const run = async (busyKey: string, fn: () => Promise<void>) => {
    setBusy(busyKey);
    try {
      await fn();
    } finally {
      setBusy(null);
    }
  };

  const syncCustomers = () => run('customers', async () => {
    const data = await invokeWithAuth<Record<string, unknown>>('stripe-sync-customers');
    toast.success(
      `Stripe customers: ${String(data.created ?? 0)} created, ${String(data.updated ?? 0)} updated, ${String(data.unchanged ?? 0)} unchanged`,
    );
  });

  const syncProducts = () => run('products', async () => {
    const data = await invokeWithAuth<Record<string, unknown>>('stripe-sync-products');
    toast.success(
      `Stripe products: ${String(data.created_products ?? 0)} created, ${String(data.updated_products ?? 0)} updated, ${String(data.created_prices ?? 0)} prices refreshed`,
    );
  });

  const syncAll = () => run('all', async () => {
    const customerData = await invokeWithAuth<Record<string, unknown>>('stripe-sync-customers');
    const productData = await invokeWithAuth<Record<string, unknown>>('stripe-sync-products');
    toast.success(
      `Stripe sync complete: ${String(customerData.created ?? 0)} customers created, ${String(productData.created_products ?? 0)} products created`,
    );
  });

  const Btn = ({ label, busyKey, onClick }: { label: string; busyKey: string; onClick: () => void }) => (
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
        <SectionHead>Stripe</SectionHead>
        <p className="text-xs text-zinc-500 py-4">Checking Stripe mode...</p>
      </SurfaceCard>
    );
  }

  const mode = status?.stripe_test_mode ? 'Test Mode' : 'Live Mode';
  const color = status?.stripe_test_mode ? '#F59E0B' : '#22C55E';

  return (
    <SurfaceCard>
      <div className="flex items-center justify-between">
        <SectionHead>Stripe</SectionHead>
        <Badge label={mode} color={color} small />
      </div>

      <div className="mt-3 space-y-4">
        <p className="text-[11px] text-zinc-500">
          Sync local customers and saleable SKU variants into Stripe so they can be reused in the Stripe catalog and in-person sales flows.
        </p>

        <div>
          <p className="text-[9px] uppercase tracking-wider text-zinc-400 mb-1.5">Sync</p>
          <div className="flex flex-wrap gap-1.5">
            <Btn label="Customers" busyKey="customers" onClick={syncCustomers} />
            <Btn label="Products" busyKey="products" onClick={syncProducts} />
            <Btn label="Sync All" busyKey="all" onClick={syncAll} />
          </div>
        </div>

        <p className="text-[10px] text-zinc-500">
          Note: Stripe mobile card-present flows are still amount-first. Product sync populates the Stripe catalog for reusable customer/catalog workflows and future POS improvements.
        </p>
      </div>
    </SurfaceCard>
  );
}
