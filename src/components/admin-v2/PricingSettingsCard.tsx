import { useState } from 'react';
import {
  useChannelPricingConfig,
  usePricingSettings,
  useUpdateChannelPricingConfig,
  useUpdatePricingSetting,
  type ChannelPricingConfig,
} from '@/hooks/admin/use-pricing-settings';
import { useSellingCostDefaults, useUpdateSellingCostDefault, getSellingCostLabel } from '@/hooks/admin/use-selling-cost-defaults';
import { SurfaceCard, SectionHead, Mono } from './ui-primitives';
import { toast } from 'sonner';
import { Check, X } from 'lucide-react';
import { Switch } from '@/components/ui/switch';

const FORMAT: Record<string, (v: number) => string> = {
  minimum_margin_target: (v) => `${(v * 100).toFixed(0)}%`,
  first_markdown_pct: (v) => `${(v * 100).toFixed(0)}%`,
  clearance_markdown_pct: (v) => `${(v * 100).toFixed(0)}%`,
  first_markdown_days: (v) => `${v} days`,
  clearance_markdown_days: (v) => `${v} days`,
};

const COST_FORMAT: Record<string, (v: number) => string> = {
  packaging_cost: (v) => `£${Number(v).toFixed(2)}`,
  risk_reserve_rate: (v) => `${(Number(v) * 100).toFixed(2)}%`,
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
  const { data: channelConfigs, isLoading: channelConfigsLoading } = useChannelPricingConfig();
  const updateSetting = useUpdatePricingSetting();
  const updateCost = useUpdateSellingCostDefault();
  const updateChannelConfig = useUpdateChannelPricingConfig();
  const [editing, setEditing] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [editSource, setEditSource] = useState<'pricing' | 'cost'>('pricing');
  const [editingChannel, setEditingChannel] = useState<string | null>(null);
  const [channelDraft, setChannelDraft] = useState<Record<string, string | boolean>>({});

  const startEdit = (key: string, currentValue: number, source: 'pricing' | 'cost') => {
    setEditing(key);
    if (source === 'cost' && key === 'risk_reserve_rate') {
      setEditValue(String(Number(currentValue) * 100));
    } else {
      setEditValue(String(currentValue));
    }
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
        const normalized = key === 'risk_reserve_rate' ? num / 100 : num;
        await updateCost.mutateAsync({ id, value: normalized });
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

  const startChannelEdit = (config: ChannelPricingConfig) => {
    setEditingChannel(config.channel);
    setChannelDraft({
      auto_price_enabled: config.auto_price_enabled,
      max_increase_pct: String(Number(config.max_increase_pct ?? 0) * 100),
      max_increase_amount: config.max_increase_amount == null ? '' : String(config.max_increase_amount),
      max_decrease_pct: String(Number(config.max_decrease_pct ?? 0) * 100),
      max_decrease_amount: config.max_decrease_amount == null ? '' : String(config.max_decrease_amount),
      market_undercut_min_pct: String(Number(config.market_undercut_min_pct ?? 0) * 100),
      market_undercut_min_amount: String(config.market_undercut_min_amount ?? 0),
      market_undercut_max_pct: config.market_undercut_max_pct == null ? '' : String(Number(config.market_undercut_max_pct) * 100),
      market_undercut_max_amount: config.market_undercut_max_amount == null ? '' : String(config.market_undercut_max_amount),
    });
  };

  const draftNumber = (key: string, divisor = 1): number | null => {
    const value = channelDraft[key];
    if (value == null || value === '') return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed / divisor : null;
  };

  const saveChannelConfig = async (config: ChannelPricingConfig) => {
    const pctKeys = ['max_increase_pct', 'max_decrease_pct', 'market_undercut_min_pct', 'market_undercut_max_pct'];
    const amountKeys = ['max_increase_amount', 'max_decrease_amount', 'market_undercut_min_amount', 'market_undercut_max_amount'];
    for (const key of [...pctKeys, ...amountKeys]) {
      const value = channelDraft[key];
      if (value !== '' && value != null && (!Number.isFinite(Number(value)) || Number(value) < 0)) {
        toast.error('Channel pricing values must be positive numbers');
        return;
      }
    }

    try {
      await updateChannelConfig.mutateAsync({
        ...config,
        auto_price_enabled: Boolean(channelDraft.auto_price_enabled),
        max_increase_pct: draftNumber('max_increase_pct', 100),
        max_increase_amount: draftNumber('max_increase_amount'),
        max_decrease_pct: draftNumber('max_decrease_pct', 100),
        max_decrease_amount: draftNumber('max_decrease_amount'),
        market_undercut_min_pct: draftNumber('market_undercut_min_pct', 100) ?? 0,
        market_undercut_min_amount: draftNumber('market_undercut_min_amount') ?? 0,
        market_undercut_max_pct: draftNumber('market_undercut_max_pct', 100),
        market_undercut_max_amount: draftNumber('market_undercut_max_amount'),
      });
      toast.success('Channel pricing updated');
      setEditingChannel(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update channel pricing');
    }
  };

  if (isLoading || costsLoading || channelConfigsLoading) {
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

      <SurfaceCard>
        <SectionHead>Channel Pricing Controls</SectionHead>
        <p className="text-xs text-zinc-500 mt-1 mb-4">
          Per-channel auto-pricing guardrails, price movement limits, and market undercut controls.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[980px] text-xs">
            <thead>
              <tr className="border-b border-zinc-200 text-left text-[10px] uppercase tracking-wider text-zinc-500">
                <th className="px-2 py-2 font-medium">Channel</th>
                <th className="px-2 py-2 font-medium">Auto</th>
                <th className="px-2 py-2 font-medium text-right">Max up %</th>
                <th className="px-2 py-2 font-medium text-right">Max up £</th>
                <th className="px-2 py-2 font-medium text-right">Max down %</th>
                <th className="px-2 py-2 font-medium text-right">Max down £</th>
                <th className="px-2 py-2 font-medium text-right">Min undercut %</th>
                <th className="px-2 py-2 font-medium text-right">Min undercut £</th>
                <th className="px-2 py-2 font-medium text-right">Max undercut %</th>
                <th className="px-2 py-2 font-medium text-right">Max undercut £</th>
                <th className="px-2 py-2 w-16"></th>
              </tr>
            </thead>
            <tbody>
              {(channelConfigs ?? []).map((config) => {
                const editingThis = editingChannel === config.channel;
                const input = (key: string, width = 'w-20') => (
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={String(channelDraft[key] ?? '')}
                    onChange={(e) => setChannelDraft((draft) => ({ ...draft, [key]: e.target.value }))}
                    className={`${width} rounded border border-amber-300 bg-white px-1.5 py-1 text-right font-mono text-xs`}
                  />
                );
                const percent = (value: number | null | undefined) => value == null ? '—' : `${(Number(value) * 100).toFixed(1)}%`;
                const pounds = (value: number | null | undefined) => value == null ? '—' : `£${Number(value).toFixed(2)}`;

                return (
                  <tr
                    key={config.channel}
                    className="border-b border-zinc-100 hover:bg-zinc-50"
                    onClick={() => !editingThis && startChannelEdit(config)}
                  >
                    <td className="px-2 py-2 font-semibold text-zinc-800">{config.channel}</td>
                    <td className="px-2 py-2">
                      {editingThis ? (
                        <Switch
                          checked={Boolean(channelDraft.auto_price_enabled)}
                          onCheckedChange={(value) => setChannelDraft((draft) => ({ ...draft, auto_price_enabled: value }))}
                          onClick={(e) => e.stopPropagation()}
                        />
                      ) : (
                        <span className={config.auto_price_enabled ? 'text-teal-600' : 'text-zinc-400'}>
                          {config.auto_price_enabled ? 'On' : 'Off'}
                        </span>
                      )}
                    </td>
                    <td className="px-2 py-2 text-right font-mono">{editingThis ? input('max_increase_pct') : percent(config.max_increase_pct)}</td>
                    <td className="px-2 py-2 text-right font-mono">{editingThis ? input('max_increase_amount') : pounds(config.max_increase_amount)}</td>
                    <td className="px-2 py-2 text-right font-mono">{editingThis ? input('max_decrease_pct') : percent(config.max_decrease_pct)}</td>
                    <td className="px-2 py-2 text-right font-mono">{editingThis ? input('max_decrease_amount') : pounds(config.max_decrease_amount)}</td>
                    <td className="px-2 py-2 text-right font-mono">{editingThis ? input('market_undercut_min_pct') : percent(config.market_undercut_min_pct)}</td>
                    <td className="px-2 py-2 text-right font-mono">{editingThis ? input('market_undercut_min_amount') : pounds(config.market_undercut_min_amount)}</td>
                    <td className="px-2 py-2 text-right font-mono">{editingThis ? input('market_undercut_max_pct') : percent(config.market_undercut_max_pct)}</td>
                    <td className="px-2 py-2 text-right font-mono">{editingThis ? input('market_undercut_max_amount') : pounds(config.market_undercut_max_amount)}</td>
                    <td className="px-2 py-2">
                      {editingThis && (
                        <div className="flex gap-1">
                          <button
                            onClick={(e) => { e.stopPropagation(); saveChannelConfig(config); }}
                            disabled={updateChannelConfig.isPending}
                            className="text-amber-600 hover:text-amber-500"
                          >
                            <Check className="h-3.5 w-3.5" />
                          </button>
                          <button
                            onClick={(e) => { e.stopPropagation(); setEditingChannel(null); }}
                            className="text-zinc-400 hover:text-zinc-600"
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </SurfaceCard>
    </div>
  );
}
