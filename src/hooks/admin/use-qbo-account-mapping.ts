// ============================================================
// Admin V2 — QBO Account Mapping Hooks
// Covers: useQboAccountMapping, useUpdateAccountMapping
// ============================================================

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { QboAccountMappingEntry } from '@/lib/types/admin';

// ─── Query Keys ─────────────────────────────────────────────

export const qboMappingKeys = {
  all: ['v2', 'qbo-account-mapping'] as const,
};

// ─── Row → Interface Mapper ────────────────────────────────

function mapEntry(row: Record<string, unknown>): QboAccountMappingEntry {
  return {
    id: row.id as string,
    purpose: row.purpose as string,
    qboAccountId: row.qbo_account_id as string,
    qboAccountName: row.qbo_account_name as string,
    accountType: row.account_type as string,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

// ─── useQboAccountMapping ──────────────────────────────────

export function useQboAccountMapping() {
  return useQuery({
    queryKey: qboMappingKeys.all,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('qbo_account_mapping' as never)
        .select('*')
        .order('purpose', { ascending: true });

      if (error) throw error;
      return ((data ?? []) as Record<string, unknown>[]).map(mapEntry);
    },
  });
}

// ─── useUpdateAccountMapping ───────────────────────────────

export function useUpdateAccountMapping() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      purpose,
      qboAccountId,
      qboAccountName,
      accountType,
    }: {
      purpose: string;
      qboAccountId: string;
      qboAccountName: string;
      accountType: string;
    }) => {
      const { error } = await supabase
        .from('qbo_account_mapping' as never)
        .upsert({
          purpose,
          qbo_account_id: qboAccountId,
          qbo_account_name: qboAccountName,
          account_type: accountType,
          updated_at: new Date().toISOString(),
        } as never, { onConflict: 'purpose' as never });

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: qboMappingKeys.all });
    },
  });
}
