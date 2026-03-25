import { useState } from 'react';
import { usePricingSettings, useUpdatePricingSetting } from '@/hooks/admin/use-pricing-settings';
import { SurfaceCard, SectionHead, Mono } from './ui-primitives';
import { toast } from 'sonner';

const FORMAT: Record<string, (v: number) => string> = {
  minimum_margin_target: (v) => `${(v * 100).toFixed(0)}%`,
  first_markdown_pct: (v) => `${(v * 100).toFixed(0)}%`,
  clearance_markdown_pct: (v) => `${(v * 100).toFixed(0)}%`,
  first_markdown_days: (v) => `${v} days`,
  clearance_markdown_days: (v) => `${v} days`,
};

const INPUT_HINT: Record<string, string> = {
  minimum_margin_target: 'Decimal (e.g. 0.25 = 25%)',
  first_markdown_pct: 'Decimal (e.g. 0.10 = 10%)',
  clearance_markdown_pct: 'Decimal (e.g. 0.20 = 20%)',
  first_markdown_days: 'Days',
  clearance_markdown_days: 'Days',
};

export function PricingSettingsCard() {
  const { data: settings, isLoading } = usePricingSettings();
  const updateSetting = useUpdatePricingSetting();
  const [editing, setEditing] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');

  const startEdit = (key: string, currentValue: number) => {
    setEditing(key);
    setEditValue(String(currentValue));
  };

  const save = async (key: string) => {
    const num = parseFloat(editValue);
    if (isNaN(num) || num < 0) {
      toast.error('Invalid value');
      return;
    }
    try {
      await updateSetting.mutateAsync({ key, value: num });
      toast.success('Setting updated');
      setEditing(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update');
    }
  };

  const cancel = () => setEditing(null);

  if (isLoading) {
    return (
      <SurfaceCard>
        <SectionHead>Pricing Engine</SectionHead>
        <p className="text-xs text-zinc-500 py-4">Loading...</p>
      </SurfaceCard>
    );
  }

  return (
    <SurfaceCard>
      <SectionHead>Pricing Engine</SectionHead>
      <p className="text-xs text-zinc-500 mt-1 mb-4">
        Floor price guardrails and automated markdown thresholds.
      </p>

      <div className="space-y-2">
        {(settings ?? []).map((s) => (
          <div
            key={s.key}
            className="flex items-center justify-between py-2 px-3 rounded bg-zinc-50 hover:bg-zinc-100 transition-colors"
          >
            <div className="text-xs text-zinc-700">{s.label}</div>

            {editing === s.key ? (
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={editValue}
                  onChange={(e) => setEditValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') save(s.key);
                    if (e.key === 'Escape') cancel();
                  }}
                  autoFocus
                  className="w-20 px-2 py-1 text-xs border border-amber-300 rounded bg-white text-right font-mono focus:outline-none focus:ring-1 focus:ring-amber-400"
                  placeholder={INPUT_HINT[s.key] ?? ''}
                />
                <button
                  onClick={() => save(s.key)}
                  disabled={updateSetting.isPending}
                  className="text-[10px] text-amber-600 hover:text-amber-500 font-medium"
                >
                  Save
                </button>
                <button
                  onClick={cancel}
                  className="text-[10px] text-zinc-400 hover:text-zinc-600"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button
                onClick={() => startEdit(s.key, s.value)}
                className="text-xs font-mono text-zinc-900 hover:text-amber-600 transition-colors cursor-pointer bg-transparent border-none"
              >
                <Mono color="teal">{FORMAT[s.key]?.(s.value) ?? String(s.value)}</Mono>
              </button>
            )}
          </div>
        ))}
      </div>
    </SurfaceCard>
  );
}
