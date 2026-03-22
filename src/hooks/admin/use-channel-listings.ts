// ============================================================
// Admin V2 — Channel Listing Hooks
// Covers: useChannelListings, usePublishListing, useBatchPublishListings
// ============================================================

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type {
  ChannelListing,
  Channel,
  ChannelListingStatus,
} from '@/lib/types/admin';
import { productKeys } from './use-products';

// ─── Query Keys ─────────────────────────────────────────────

export const channelListingKeys = {
  all: ['v2', 'channel-listings'] as const,
  byVariant: (sku: string) => ['v2', 'channel-listings', 'variant', sku] as const,
};

// ─── Row → Interface Mapper ────────────────────────────────

function mapListing(row: Record<string, unknown>, skuCode: string): ChannelListing {
  return {
    id: row.id as string,
    sku: skuCode,
    channel: (row.v2_channel as Channel) ?? (row.channel as Channel) ?? 'website',
    status: (row.v2_status as ChannelListingStatus) ?? 'draft',
    externalId: (row.external_listing_id as string) ?? null,
    externalUrl: (row.external_url as string) ?? null,
    listedAt: (row.listed_at as string) ?? null,
  };
}

// ─── useChannelListings ─────────────────────────────────────

export function useChannelListings(skuCode: string | undefined) {
  return useQuery({
    queryKey: channelListingKeys.byVariant(skuCode ?? ''),
    enabled: !!skuCode,
    queryFn: async () => {
      // Look up sku id
      const { data: skuRow, error: skuErr } = await supabase
        .from('sku')
        .select('id')
        .eq('sku_code', skuCode!)
        .single();

      if (skuErr) throw skuErr;

      const { data, error } = await supabase
        .from('channel_listing')
        .select('*')
        .eq('sku_id', skuRow.id)
        .order('created_at', { ascending: false });

      if (error) throw error;
      return ((data ?? []) as Record<string, unknown>[]).map((r) => mapListing(r, skuCode!));
    },
  });
}

// ─── usePublishListing ──────────────────────────────────────

interface PublishListingInput {
  skuCode: string;
  channel: Channel;
  externalId?: string;
  externalUrl?: string;
}

export function usePublishListing() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ skuCode, channel, externalId, externalUrl }: PublishListingInput) => {
      // Look up sku id
      const { data: skuRow, error: skuErr } = await supabase
        .from('sku')
        .select('id')
        .eq('sku_code', skuCode)
        .single();

      if (skuErr) throw skuErr;

      // Upsert listing
      const { data, error } = await supabase
        .from('channel_listing')
        .upsert(
          {
            sku_id: skuRow.id,
            channel: channel,
            v2_channel: channel,
            v2_status: 'live',
            external_listing_id: externalId ?? null,
            external_url: externalUrl ?? null,
            listed_at: new Date().toISOString(),
          } as never,
          { onConflict: 'sku_id,channel' as never },
        )
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: channelListingKeys.byVariant(variables.skuCode) });
      queryClient.invalidateQueries({ queryKey: productKeys.all });
    },
  });
}

// ─── useBatchPublishListings ────────────────────────────────

interface BatchPublishInput {
  skuCode: string;
  channels: Channel[];
}

export function useBatchPublishListings() {
  const publishListing = usePublishListing();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ skuCode, channels }: BatchPublishInput) => {
      const results = [];
      for (const channel of channels) {
        const result = await publishListing.mutateAsync({ skuCode, channel });
        results.push(result);
      }
      return results;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: channelListingKeys.byVariant(variables.skuCode) });
      queryClient.invalidateQueries({ queryKey: productKeys.all });
    },
  });
}
