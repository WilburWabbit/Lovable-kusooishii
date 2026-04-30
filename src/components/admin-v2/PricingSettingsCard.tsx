import { useState } from 'react';
import { usePricingSettings, useUpdatePricingSetting } from '@/hooks/admin/use-pricing-settings';
import { useSellingCostDefaults, useUpdateSellingCostDefault, getSellingCostLabel } from '@/hooks/admin/use-selling-cost-defaults';
import { SurfaceCard, SectionHead, Mono } from './ui-primitives';
import { toast } from 'sonner';

const FORMAT: Record<string, (v: number) => string> = {
  minimum_margin_target: (v) => `${(v * 100).toFixed(0)}%`,
  first_markdown_pct: (v) => `${(v * 100).toFixed(0)}%`,
  clearance_markdown_pct: (v) => `${(v * 100).toFixed(0)}%`,
  first_markdown_days: (v) => `${v} days`,
  clearance_markdown_days: (v) => `${v} days`,
};

const COST_FORMAT: Record<string, (v: number) => string> = {
  packaging_cost: (v) => `£${Number(v).toFixed(2)}`,
  risk_reserve_rate: (v) => `${v}%`,
  condition_multiplier_1: (v) => `×${v}`,
  condition_multiplier_2: (v) => `×${v}`,
  condition_multiplier_3: (v) => `×${v}`,
  condition_multiplier_4: (v) => `×${v}`,
  minimum_margin_rate: (v) => `${(v * 100).toFixed(0)}%`,
  minimum_profit_amount: (v) => `£${Number(v).toFixed(2)}`,
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
  const { data: costDefaults, isLoading: costsLoading } = useSellingCostDefaults();
  const updateSetting = useUpdatePricingSetting();
  const updateCost = useUpdateSellingCostDefault();
  const [editing, setEditing] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [editSource, setEditSource] = useState<'pricing' | 'cost'>('pricing');

  const startEdit = (key: string, currentValue: number, source: 'pricing' | 'cost') => {
    setEditing(key);
    setEditValue(String(currentValue));
    setEditSource(source);
  };

  const save = async (key: string, id?: string) => {
    const num = parseFloat(editValue);
    if (isNaN(num) || num < 0) {
      toast.error('Invalid value');
      return;
    }
    try {
      if (editSource === 'cost' && id) {
        await updateCost.mutateAsync({ id, value: num });
      } else {
        await updateSetting.mutateAsync({ key, value: num });
      }
      toast.success('Setting updated');
      setEditing(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update');
    }
  };

  const cancel = () => setEditing(null);

  if (isLoading || costsLoading) {
    return (
      <SurfaceCard>
        <SectionHead>Pricing Engine</SectionHead>
        <p className="text-xs text-zinc-500 py-4">Loading...</p>
      </SurfaceCard>
    );
  }

  const renderRow = (key: string, value: number, format: Record<string, (v: number) => string>, label: string, source: 'pricing' | 'cost', id?: string) => (
    <div
      key={key}
      className="flex items-center justify-between py-2 px-3 rounded bg-zinc-50 hover:bg-zinc-100 transition-colors"
    >
      <div className="text-xs text-zinc-700">{label}</div>

      {editing === key ? (
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') save(key, id);
              if (e.key === 'Escape') cancel();
            }}
            autoFocus
            className="w-20 px-2 py-1 text-xs border border-amber-300 rounded bg-white text-right font-mono focus:outline-none focus:ring-1 focus:ring-amber-400"
            placeholder={INPUT_HINT[key] ?? ''}
          />
          <button
            onClick={() => save(key, id)}
            disabled={updateSetting.isPending || updateCost.isPending}
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
          onClick={() => startEdit(key, value, source)}
          className="text-xs font-mono text-zinc-900 hover:text-amber-600 transition-colors cursor-pointer bg-transparent border-none"
        >
          <Mono color="teal">{format[key]?.(value) ?? String(value)}</Mono>
        </button>
      )}
    </div>
  );

  return (
    <div className="space-y-4">
      <SurfaceCard>
        <SectionHead>Pricing Engine</SectionHead>
        <p className="text-xs text-zinc-500 mt-1 mb-4">
          Floor price guardrails and automated markdown thresholds.
        </p>
        <div className="space-y-2">
          {(settings ?? []).map((s) => renderRow(s.key, s.value, FORMAT, s.label, 'pricing'))}
        </div>
      </SurfaceCard>

      <SurfaceCard>
        <SectionHead>Selling Cost Defaults</SectionHead>
        <p className="text-xs text-zinc-500 mt-1 mb-4">
          Default costs used in floor price and P&L calculations.
        </p>
        <div className="space-y-2">
          {(costDefaults ?? []).map((s) =>
            renderRow(s.key, Number(s.value), COST_FORMAT, getSellingCostLabel(s.key), 'cost', s.id)
          )}
        </div>
      </SurfaceCard>
    </div>
  );
}
