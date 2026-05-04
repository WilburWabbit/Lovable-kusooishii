import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface ShippingRate {
  id: string;
  carrier: string;
  service_name: string;
  size_band: string;
  max_weight_kg: number;
  max_length_cm: number | null;
  max_width_cm: number | null;
  max_depth_cm: number | null;
  max_girth_cm: number | null;
  cost: number;
  price_ex_vat: number;
  price_inc_vat: number;
  vat_exempt: boolean;
  tracked: boolean;
  active: boolean;
  channel: string;
  tier: string | null;
  destination: string;
  est_delivery: string | null;
  max_compensation: number | null;
  created_at: string;
  updated_at: string;
}

const QUERY_KEY = ['shipping_rate_table'];

export function useShippingRates() {
  return useQuery({
    queryKey: QUERY_KEY,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('shipping_rate_table')
        .select('*')
        .order('carrier')
        .order('max_weight_kg');
      if (error) throw error;
      return data as ShippingRate[];
    },
  });
}

export function useUpsertShippingRate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (rate: Partial<ShippingRate> & { carrier: string; service_name: string }) => {
      const { data, error } = await (supabase as any)
        .from('shipping_rate_table')
        .upsert({ ...rate, updated_at: new Date().toISOString() }, { onConflict: 'id' })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: QUERY_KEY }),
  });
}

export function useDeleteShippingRate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase as any)
        .from('shipping_rate_table')
        .delete()
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: QUERY_KEY }),
  });
}
