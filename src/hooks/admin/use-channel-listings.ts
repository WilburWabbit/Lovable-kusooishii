// ============================================================
// Admin V2 — Channel Listing Hooks
// Covers: useChannelListings, useChannelFees, usePublishListing,
//         useBatchPublishListings
// ============================================================

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { invokeWithAuth } from '@/lib/invokeWithAuth';
import type {
  ChannelListing,
  Channel,
  ChannelAvailabilityOverride,
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

interface ListingPriceSnapshot {
  estimatedFees: number | null;
  estimatedNet: number | null;
}

function mapListing(
  row: Record<string, unknown>,
  skuCode: string,
  snapshotsById: Map<string, ListingPriceSnapshot> = new Map(),
): ChannelListing {
  const snapshotId = row.current_price_decision_snapshot_id as string | null;
  const snapshot = snapshotId ? snapshotsById.get(snapshotId) : undefined;

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
    listedQuantity: (row.listed_quantity as number) ?? null,
    offerStatus: (row.offer_status as string) ?? null,
    availabilityOverride: (row.availability_override as ChannelAvailabilityOverride) ?? null,
    availabilityOverrideAt: (row.availability_override_at as string) ?? null,
    availabilityOverrideBy: (row.availability_override_by as string) ?? null,
    feeAdjustedPrice: (row.fee_adjusted_price as number) ?? null,
    estimatedFees: snapshot?.estimatedFees ?? null,
    estimatedNet: snapshot?.estimatedNet ?? null,
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

      // Collapse duplicates: legacy data sometimes contains more than one
      // channel_listing per (sku, channel). When that happens, prefer the row
      // that's actually bound to an external listing/offer, then the most
      // recently updated. Otherwise UI edits land on a stale empty row while
      // the real live listing keeps drifting.
      const rows = (data ?? []) as Record<string, unknown>[];
      const byChannel = new Map<string, Record<string, unknown>>();
      const score = (r: Record<string, unknown>) => {
        const hasExternal = r.external_listing_id ? 2 : 0;
        const hasTitle =
          typeof r.listing_title === 'string' && (r.listing_title as string).trim() ? 1 : 0;
        return hasExternal + hasTitle;
      };
      for (const r of rows) {
        const key = ((r.v2_channel as string) ?? (r.channel as string) ?? 'website');
        const existing = byChannel.get(key);
        if (!existing) {
          byChannel.set(key, r);
          continue;
        }
        const sNew = score(r);
        const sOld = score(existing);
        if (sNew > sOld) {
          byChannel.set(key, r);
        } else if (sNew === sOld) {
          const tNew = new Date((r.updated_at as string) ?? (r.created_at as string) ?? 0).getTime();
          const tOld = new Date((existing.updated_at as string) ?? (existing.created_at as string) ?? 0).getTime();
          if (tNew > tOld) byChannel.set(key, r);
        }
      }
      const collapsedRows = [...byChannel.values()];
      const snapshotIds = [
        ...new Set(
          collapsedRows
            .map((r) => r.current_price_decision_snapshot_id)
            .filter((id): id is string => typeof id === 'string' && id.length > 0),
        ),
      ];

      const snapshotsById = new Map<string, ListingPriceSnapshot>();
      if (snapshotIds.length > 0) {
        const { data: snapshotRows, error: snapshotErr } = await supabase
          .from('price_decision_snapshot' as never)
          .select('id, estimated_fees, expected_net_before_cogs')
          .in('id' as never, snapshotIds as never);

        if (snapshotErr) throw snapshotErr;

        for (const snapshot of (snapshotRows ?? []) as Record<string, unknown>[]) {
          snapshotsById.set(snapshot.id as string, {
            estimatedFees: (snapshot.estimated_fees as number) ?? null,
            estimatedNet: (snapshot.expected_net_before_cogs as number) ?? null,
          });
        }
      }

      return collapsedRows.map((r) => mapListing(r, skuCode!, snapshotsById));
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
  allowBelowFloor?: boolean;
  overrideReasonCode?: string;
  overrideReasonNote?: string;
}

export function usePublishListing() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      skuCode, channel, listingTitle, listingDescription,
      listingPrice,
      externalId, externalUrl, allowBelowFloor, overrideReasonCode, overrideReasonNote,
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

      // Normalize channel value: legacy `channel` column uses 'web' for the
      // website, while v2_channel uses 'website'. The UI/Channel type sends
      // 'website' — translate so we update the existing row instead of
      // creating a duplicate (and tripping the (channel, external_sku) unique
      // constraint downstream).
      const legacyChannel = channel === 'website' ? 'web' : channel;
      const v2Channel = channel === 'web' ? 'website' : channel;

      // There is no (sku_id, channel) unique constraint, so a true upsert
      // can't disambiguate the row. Look up ALL rows for this (sku, channel)
      // pair and pick the canonical one — preferring rows already bound to
      // an external listing/offer — so edits don't land on a stale duplicate
      // while the live listing keeps drifting.
      const { data: existingRows, error: lookupErr } = await supabase
        .from('channel_listing')
        .select('id, external_listing_id, listing_title, v2_status, listed_at, updated_at, created_at')
        .eq('sku_id', skuId)
        .in('channel', [legacyChannel, channel] as never);

      if (lookupErr) throw lookupErr;

      const candidates = (existingRows ?? []) as Array<Record<string, unknown>>;
      const scoreRow = (r: Record<string, unknown>) =>
        (r.external_listing_id ? 2 : 0) +
        (typeof r.listing_title === 'string' && (r.listing_title as string).trim() ? 1 : 0);
      candidates.sort((a, b) => {
        const diff = scoreRow(b) - scoreRow(a);
        if (diff !== 0) return diff;
        const ta = new Date((a.updated_at as string) ?? (a.created_at as string) ?? 0).getTime();
        const tb = new Date((b.updated_at as string) ?? (b.created_at as string) ?? 0).getTime();
        return tb - ta;
      });
      const existingRow = candidates[0];
      const existingId = existingRow?.id as string | undefined;
      const wasLive = existingRow?.v2_status === 'live';
      const existingListedAt = (existingRow?.listed_at as string | null) ?? null;

      const payload = {
        sku_id: skuId,
        channel: legacyChannel,
        v2_channel: v2Channel,
        v2_status: wasLive ? 'live' : 'draft',
        // external_sku is NOT NULL on channel_listing; default to the SKU code
        // so first-time publishes don't fail. Marketplace sync may later
        // overwrite this with a marketplace-assigned SKU.
        external_sku: skuCode,
        listing_title: listingTitle.trim(),
        listing_description: listingDescription?.trim() ?? null,
        listed_price: listingPrice,
        fee_adjusted_price: listingPrice,
        external_listing_id: externalId ?? null,
        external_url: externalUrl ?? null,
        listed_at: wasLive ? existingListedAt ?? new Date().toISOString() : null,
      };

      let data: unknown;
      if (existingId) {
        const { data: updated, error: updErr } = await supabase
          .from('channel_listing')
          .update(payload as never)
          .eq('id', existingId)
          .select()
          .single();
        if (updErr) throw updErr;
        data = updated;
      } else {
        const { data: inserted, error: insErr } = await supabase
          .from('channel_listing')
          .insert(payload as never)
          .select()
          .single();
        if (insErr) throw insErr;
        data = inserted;
      }

      const listingId = (data as Record<string, unknown>).id as string;
      const commandType = wasLive ? 'reprice' : 'publish';

      const { data: snapshotData, error: snapshotError } = await supabase
        .rpc('create_price_decision_snapshot' as never, {
          p_sku_id: skuId,
          p_channel: channel,
          p_channel_listing_id: listingId,
          p_candidate_price: listingPrice,
        } as never);

      if (snapshotError) throw snapshotError;
      const snapshotId = snapshotData as unknown as string | null;

      if (allowBelowFloor) {
        if (!snapshotId) throw new Error('Cannot approve override without a price decision snapshot');
        if (!overrideReasonCode?.trim()) throw new Error('Override reason is required');

        const { error: overrideError } = await supabase
          .rpc('record_price_override_approval' as never, {
            p_price_decision_snapshot_id: snapshotId,
            p_reason_code: overrideReasonCode.trim(),
            p_reason_note: overrideReasonNote?.trim() || null,
          } as never);

        if (overrideError) throw overrideError;
      }

      const { error: commandError } = await supabase
        .rpc('queue_listing_command' as never, {
          p_channel_listing_id: listingId,
          p_command_type: commandType,
          p_allow_below_floor: !!allowBelowFloor,
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

// ─── useChannelListingAction ───────────────────────────────

type ChannelListingAction =
  | 'set-channel-out-of-stock'
  | 'clear-channel-out-of-stock'
  | 'delist-channel-listing';

interface ChannelListingActionInput {
  skuCode: string;
  listingId: string;
  action: ChannelListingAction;
}

export function useChannelListingAction() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ listingId, action }: ChannelListingActionInput) => {
      return invokeWithAuth('admin-data', {
        action,
        listing_id: listingId,
      });
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
