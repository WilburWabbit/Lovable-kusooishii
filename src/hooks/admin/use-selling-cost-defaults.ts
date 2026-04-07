import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface SellingCostDefault {
  id: string;
  key: string;
  value: number;
  updated_at: string;
}

const QUERY_KEY = ['selling_cost_defaults'];

const LABELS: Record<string, string> = {
  packaging_cost: 'Packaging Cost (£)',
  risk_reserve_rate: 'Risk Reserve Rate (%)',
  condition_multiplier_1: 'Condition 1 Multiplier',
  condition_multiplier_2: 'Condition 2 Multiplier',
  condition_multiplier_3: 'Condition 3 Multiplier',
  condition_multiplier_4: 'Condition 4 Multiplier',
  minimum_margin_rate: 'Minimum Margin Rate',
  minimum_profit_amount: 'Minimum Profit (£)',
};

export function getSellingCostLabel(key: string) {
  return LABELS[key] ?? key;
}

export function useSellingCostDefaults() {
  return useQuery({
    queryKey: QUERY_KEY,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('selling_cost_defaults')
        .select('*')
        .order('key');
      if (error) throw error;
      return data as SellingCostDefault[];
    },
  });
}

export function useUpdateSellingCostDefault() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, value }: { id: string; value: number }) => {
      const { error } = await (supabase as any)
        .from('selling_cost_defaults')
        .update({ value, updated_at: new Date().toISOString() })
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: QUERY_KEY }),
  });
}
