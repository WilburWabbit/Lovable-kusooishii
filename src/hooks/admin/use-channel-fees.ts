import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface ChannelFee {
  id: string;
  channel: string;
  fee_name: string;
  rate_percent: number;
  fixed_amount: number;
  applies_to: string;
  min_amount: number | null;
  max_amount: number | null;
  active: boolean;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

const QUERY_KEY = ['channel_fee_schedule'];

export function useChannelFees() {
  return useQuery({
    queryKey: QUERY_KEY,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('channel_fee_schedule')
        .select('*')
        .order('channel')
        .order('fee_name');
      if (error) throw error;
      return data as ChannelFee[];
    },
  });
}

export function useUpsertChannelFee() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (fee: Partial<ChannelFee> & { channel: string; fee_name: string }) => {
      const { data, error } = await (supabase as any)
        .from('channel_fee_schedule')
        .upsert({ ...fee, updated_at: new Date().toISOString() }, { onConflict: 'id' })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: QUERY_KEY }),
  });
}

export function useDeleteChannelFee() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase as any)
        .from('channel_fee_schedule')
        .delete()
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: QUERY_KEY }),
  });
}
