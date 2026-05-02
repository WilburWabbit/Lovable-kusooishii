import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { invokeWithAuth } from '@/lib/invokeWithAuth';
import { Badge, SectionHead, SurfaceCard } from './ui-primitives';

type AiProvider = 'lovable' | 'openai';

type AiProviderStatus = {
  ai_provider: AiProvider;
};

const PROVIDER_LABEL: Record<AiProvider, string> = {
  lovable: 'Lovable AI',
  openai: 'OpenAI',
};

export function AiProviderSettingsCard() {
  const [status, setStatus] = useState<AiProviderStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<AiProvider | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const data = await invokeWithAuth<AiProviderStatus>('admin-data', { action: 'get-ai-provider' });
        setStatus(data);
      } catch {
        setStatus({ ai_provider: 'lovable' });
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const setProvider = async (provider: AiProvider) => {
    if (status?.ai_provider === provider) return;
    setBusy(provider);
    try {
      const data = await invokeWithAuth<AiProviderStatus>('admin-data', {
        action: 'set-ai-provider',
        provider,
      });
      setStatus(data);
      toast.success(`AI provider set to ${PROVIDER_LABEL[data.ai_provider]}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to update AI provider');
    } finally {
      setBusy(null);
    }
  };

  if (loading) {
    return (
      <SurfaceCard>
        <SectionHead>AI Provider</SectionHead>
        <p className="text-xs text-muted-foreground py-4">Checking AI provider…</p>
      </SurfaceCard>
    );
  }

  const active = status?.ai_provider ?? 'lovable';

  const Btn = ({ provider }: { provider: AiProvider }) => {
    const isActive = active === provider;
    return (
      <button
        onClick={() => setProvider(provider)}
        disabled={!!busy || isActive}
        className={`px-3 py-1.5 rounded text-xs font-medium border transition-colors flex items-center gap-1.5 disabled:cursor-not-allowed ${
          isActive
            ? 'border-zinc-900 bg-zinc-900 text-white'
            : 'border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-50 disabled:opacity-40'
        }`}
      >
        {busy === provider && <Loader2 className="h-3 w-3 animate-spin" />}
        {PROVIDER_LABEL[provider]}
      </button>
    );
  };

  return (
    <SurfaceCard>
      <div className="flex items-center justify-between">
        <SectionHead>AI Provider</SectionHead>
        <Badge label={PROVIDER_LABEL[active]} color="#6366F1" small />
      </div>

      <div className="mt-3 space-y-4">
        <p className="text-[11px] text-zinc-500">
          Controls which provider generates product copy, SEO content, and identifies LEGO age marks.
          When <strong>Lovable AI</strong> is active and returns a rate-limit or out-of-credits error,
          the platform automatically falls back to OpenAI for that request.
        </p>

        <div>
          <p className="text-[9px] uppercase tracking-wider text-zinc-400 mb-1.5">Provider</p>
          <div className="flex flex-wrap gap-1.5">
            <Btn provider="lovable" />
            <Btn provider="openai" />
          </div>
        </div>

        <p className="text-[10px] text-zinc-500">
          Lovable AI uses the auto-provisioned workspace key — no separate billing required.
          OpenAI calls require an active <code>OPENAI_API_KEY</code> with billing credits.
        </p>
      </div>
    </SurfaceCard>
  );
}
