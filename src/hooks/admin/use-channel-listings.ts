// ============================================================
// Admin V2 — Channel Listing Hooks
// Covers: useChannelListings, useChannelFees, usePublishListing,
//         useBatchPublishListings
// ============================================================

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type {
  ChannelListing,
  Channel,
  ChannelListingStatus,
} from '@/lib/types/admin';
import { productKeys } from './use-products';
import { stockUnitKeys } from './use-stock-units';

// ─── Query Keys ─────────────────────────────────────────────

export const channelListingKeys = {
  all: ['v2', 'channel-listings'] as const,
  byVariant: (sku: string) => ['v2', 'channel-listings', 'variant', sku] as const,
  fees: (channel: string) => ['v2', 'channel-fees', channel] as const,
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
    listingTitle: (row.listing_title as string) ?? null,
    listingDescription: (row.listing_description as string) ?? null,
    listingPrice: (row.listed_price as number) ?? null,
    feeAdjustedPrice: (row.fee_adjusted_price as number) ?? null,
    estimatedFees: (row.estimated_fees as number) ?? null,
    estimatedNet: (row.estimated_net as number) ?? null,
  };
}

// ─── useChannelListings ─────────────────────────────────────

export function useChannelListings(skuCode: string | undefined) {
  return useQuery({
    queryKey: channelListingKeys.byVariant(skuCode ?? ''),
    enabled: !!skuCode,
    queryFn: async () => {
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

// ─── useChannelFees ─────────────────────────────────────────

export interface ChannelFeeInfo {
  totalFeeRate: number;
  fees: { name: string; rate: number; fixed: number }[];
}

export function useChannelFees() {
  return useQuery({
    queryKey: ['v2', 'channel-fees-all'] as const,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('channel_fee_schedule')
        .select('*')
        .eq('active', true);

      if (error) throw error;

      const feesByChannel = new Map<string, ChannelFeeInfo>();

      for (const row of ((data ?? []) as Record<string, unknown>[])) {
        const channel = row.channel as string;
        const info = feesByChannel.get(channel) ?? { totalFeeRate: 0, fees: [] };
        const rate = (row.rate_percent as number) ?? 0;
        const fixed = (row.fixed_amount as number) ?? 0;

        info.fees.push({
          name: (row.fee_name as string) ?? 'Fee',
          rate: rate / 100, // Convert from percent to decimal
          fixed,
        });
        info.totalFeeRate += rate / 100;
        feesByChannel.set(channel, info);
      }

      return feesByChannel;
    },
    staleTime: 300_000, // Cache for 5 minutes
  });
}

/** Calculate fee-aware pricing for a channel. */
export function calculateChannelPrice(
  basePrice: number,
  floorPrice: number | null,
  feeInfo: ChannelFeeInfo | undefined,
): {
  suggestedPrice: number;
  estimatedFees: number;
  estimatedNet: number;
  belowFloor: boolean;
} {
  const totalRate = feeInfo?.totalFeeRate ?? 0;
  const totalFixed = feeInfo?.fees.reduce((s, f) => s + f.fixed, 0) ?? 0;

  // Suggested price: base / (1 - totalFeeRate) + fixed fees to maintain net margin
  const suggestedPrice = totalRate < 1
    ? Math.round(((basePrice + totalFixed) / (1 - totalRate)) * 100) / 100
    : basePrice;

  const estimatedFees = Math.round((suggestedPrice * totalRate + totalFixed) * 100) / 100;
  const estimatedNet = Math.round((suggestedPrice - estimatedFees) * 100) / 100;
  const belowFloor = floorPrice != null && suggestedPrice < floorPrice;

  return { suggestedPrice, estimatedFees, estimatedNet, belowFloor };
}

// ─── usePublishListing ──────────────────────────────────────

interface PublishListingInput {
  skuCode: string;
  channel: Channel;
  listingTitle: string;
  listingDescription?: string;
  listingPrice: number;
  estimatedFees?: number;
  estimatedNet?: number;
  externalId?: string;
  externalUrl?: string;
}

export function usePublishListing() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      skuCode, channel, listingTitle, listingDescription,
      listingPrice, estimatedFees, estimatedNet,
      externalId, externalUrl,
    }: PublishListingInput) => {
      if (!listingTitle?.trim()) {
        throw new Error('Listing title is required');
      }

      // Look up SKU. Floor/margin validation now happens through the pricing
      // snapshot and outbound listing command RPCs.
      const { data: skuRow, error: skuErr } = await supabase
        .from('sku')
        .select('id' as never)
        .eq('sku_code', skuCode)
        .single();

      if (skuErr) throw skuErr;

      const skuId = (skuRow as unknown as Record<string, unknown>).id as string;

      const { data: existingListing } = await supabase
        .from('channel_listing')
        .select('id, v2_status, listed_at' as never)
        .eq('sku_id' as never, skuId)
        .eq('channel' as never, channel)
        .maybeSingle();

      const existing = existingListing as unknown as Record<string, unknown> | null;
      const wasLive = existing?.v2_status === 'live';
      const existingListedAt = (existing?.listed_at as string | null) ?? null;

      // Upsert listing with all fields
      const { data, error } = await supabase
        .from('channel_listing')
        .upsert(
          {
            sku_id: skuId,
            channel: channel,
            v2_channel: channel,
            v2_status: wasLive ? 'live' : 'draft',
            listing_title: listingTitle.trim(),
            listing_description: listingDescription?.trim() ?? null,
            listed_price: listingPrice,
            fee_adjusted_price: listingPrice,
            estimated_fees: estimatedFees ?? null,
            estimated_net: estimatedNet ?? null,
            external_listing_id: externalId ?? null,
            external_url: externalUrl ?? null,
            listed_at: wasLive ? existingListedAt ?? new Date().toISOString() : null,
          } as never,
          { onConflict: 'sku_id,channel' as never },
        )
        .select()
        .single();

      if (error) throw error;

      const listingId = (data as Record<string, unknown>).id as string;
      const commandType = wasLive ? 'reprice' : 'publish';

      const { error: snapshotError } = await supabase
        .rpc('create_price_decision_snapshot' as never, {
          p_sku_id: skuId,
          p_channel: channel,
          p_channel_listing_id: listingId,
          p_candidate_price: listingPrice,
        } as never);

      if (snapshotError) throw snapshotError;

      const { error: commandError } = await supabase
        .rpc('queue_listing_command' as never, {
          p_channel_listing_id: listingId,
          p_command_type: commandType,
        } as never);

      if (commandError) throw commandError;

      return data;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: channelListingKeys.byVariant(variables.skuCode) });
      queryClient.invalidateQueries({ queryKey: productKeys.all });
      queryClient.invalidateQueries({ queryKey: stockUnitKeys.all });
    },
  });
}

// ─── useBatchPublishListings ────────────────────────────────

interface BatchPublishInput {
  skuCode: string;
  listings: {
    channel: Channel;
    listingTitle: string;
    listingDescription?: string;
    listingPrice: number;
    estimatedFees?: number;
    estimatedNet?: number;
  }[];
}

export function useBatchPublishListings() {
  const publishListing = usePublishListing();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ skuCode, listings }: BatchPublishInput) => {
      const results = [];
      for (const listing of listings) {
        const result = await publishListing.mutateAsync({
          skuCode,
          ...listing,
        });
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
