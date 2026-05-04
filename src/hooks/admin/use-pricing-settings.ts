// ============================================================
// Admin V2 — Pricing Settings Hooks
// CRUD for the pricing_settings table (margin target, markdown config).
// ============================================================

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { invokeWithAuth } from '@/lib/invokeWithAuth';

export interface PricingSetting {
  key: string;
  value: number;
  label: string;
  updatedAt: string;
}

const QUERY_KEY = ['v2', 'pricing-settings'] as const;
const CHANNEL_CONFIG_QUERY_KEY = ['v2', 'channel-pricing-config'] as const;

export interface ChannelPricingConfig {
  id?: string;
  channel: string;
  auto_price_enabled: boolean;
  max_increase_pct: number | null;
  max_increase_amount: number | null;
  max_decrease_pct: number | null;
  max_decrease_amount: number | null;
  market_undercut_min_pct: number | null;
  market_undercut_min_amount: number | null;
  market_undercut_max_pct: number | null;
  market_undercut_max_amount: number | null;
}

export function usePricingSettings() {
  return useQuery({
    queryKey: QUERY_KEY,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('pricing_settings' as never)
        .select('*')
        .order('key');

      if (error) throw error;
      return ((data ?? []) as Record<string, unknown>[]).map(
        (row): PricingSetting => ({
          key: row.key as string,
          value: row.value as number,
          label: row.label as string,
          updatedAt: row.updated_at as string,
        }),
      );
    },
  });
}

export function useUpdatePricingSetting() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async ({ key, value }: { key: string; value: number }) => {
      const { error } = await supabase
        .from('pricing_settings' as never)
        .update({ value, updated_at: new Date().toISOString() } as never)
        .eq('key' as never, key);

      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: QUERY_KEY });
    },
  });
}

export function useChannelPricingConfig() {
  return useQuery({
    queryKey: CHANNEL_CONFIG_QUERY_KEY,
    queryFn: async () => invokeWithAuth<ChannelPricingConfig[]>('admin-data', {
      action: 'list-channel-pricing-config',
    }),
  });
}

export function useUpdateChannelPricingConfig() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (config: ChannelPricingConfig) => {
      await invokeWithAuth('admin-data', {
        action: 'upsert-channel-pricing-config',
        ...config,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: CHANNEL_CONFIG_QUERY_KEY });
    },
  });
}
