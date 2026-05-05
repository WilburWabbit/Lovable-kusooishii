import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { invokeWithAuth } from '@/lib/invokeWithAuth';
import { productKeys } from './use-products';
import { channelListingKeys } from './use-channel-listings';

export const priceTransparencyKeys = {
  detail: (mpn: string) => ['v2', 'price-transparency', mpn] as const,
};

export interface PriceContributor {
  key: string;
  label: string;
  amount: number;
  kind: string;
}

export interface PriceQuoteDetail {
  sku_id: string;
  sku_code?: string | null;
  channel: string;
  floor_price: number | null;
  target_price: number | null;
  ceiling_price: number | null;
  estimated_fees: number | null;
  estimated_net: number | null;
  carrying_value: number | null;
  average_carrying_value: number | null;
  highest_unit_carrying_value?: number | null;
  stock_unit_count: number;
  market_consensus: number | null;
  brickeconomy_rrp?: number | null;
  condition_adjusted_rrp?: number | null;
  condition_multiplier: number | null;
  confidence_score: number | null;
  target_floor_clamped?: boolean | null;
  blocking_reasons: string[];
  warning_reasons: string[];
  cost_basis?: {
    basis_strategy?: string;
    pooled_carrying_value?: number;
    highest_unit_carrying_value?: number;
    unit_count?: number;
    exposure_over_pool?: number;
  } | null;
  vat_position?: {
    vat_rate_percent?: number;
    brickeconomy_rrp?: number | null;
    condition_adjusted_rrp?: number | null;
    market_weighted_rrp_undercut?: number | null;
    sale_price_gross?: number;
    sale_output_vat?: number;
    sale_receipts_net_of_vat?: number;
    channel_fees_gross_paid?: number;
    channel_fee_input_vat_reclaim?: number;
    channel_fees_net_cost?: number;
    cost_basis_net_paid?: number;
    estimated_cash_after_fees?: number;
    estimated_net_after_vat_and_fees?: number;
    risk_reserve_net?: number;
    program_commission?: number;
    net_position_after_vat?: number;
    floor?: {
      gross_price?: number;
      output_vat?: number;
      receipts_net_of_vat?: number;
      channel_fees_gross?: number;
      channel_fee_input_vat_reclaim?: number;
      channel_fees_net?: number;
      net_position?: number;
    };
    target?: {
      gross_price?: number;
      output_vat?: number;
      receipts_net_of_vat?: number;
      channel_fees_gross?: number;
      channel_fees_net?: number;
      net_position?: number;
    };
  } | null;
  floor_contributors?: PriceContributor[];
  target_contributors?: PriceContributor[];
  breakdown?: Record<string, unknown>;
  raw_quote?: Record<string, unknown>;
}

export interface PriceMarketSnapshot {
  id: string;
  sku_id: string;
  channel: string | null;
  price: number | string | null;
  confidence_score: number | string | null;
  freshness_score: number | string | null;
  sample_size: number | string | null;
  captured_at: string | null;
  source?: { source_code?: string | null; name?: string | null } | Array<{ source_code?: string | null; name?: string | null }>;
}

export interface PriceChannelTransparency {
  channel: string;
  channel_label: string;
  listing: Record<string, unknown> | null;
  snapshot: Record<string, unknown> | null;
  override: Record<string, unknown> | null;
  override_status: 'Manual' | 'Below floor' | 'Auto' | 'Review queued' | 'Stale snapshot' | string;
  below_floor: boolean;
  manual: boolean;
  stale_snapshot: boolean;
  snapshot_age_hours: number | null;
  final_price: number | null;
  margin_amount: number | null;
  margin_rate: number | null;
  quote: PriceQuoteDetail;
  market_snapshots: PriceMarketSnapshot[];
}

export interface PriceVariantTransparency {
  sku_id: string;
  sku_code: string;
  mpn: string;
  condition_grade: number | string;
  active_flag: boolean;
  saleable_flag: boolean;
  stock_count: number;
  pooled_carrying_value: number | null;
  highest_unit_carrying_value: number | null;
  exposure_over_pool: number | null;
  channels: PriceChannelTransparency[];
}

export interface PriceTransparencyResult {
  product: {
    id: string | null;
    mpn: string;
    name: string | null;
    theme: string | null;
  };
  summary: {
    sku_count: number;
    channel_count: number;
    grade_spread: string;
    average_confidence: number | null;
    average_market_price: number | null;
    source_count: number;
    override_count: number;
    stale_snapshot_count: number;
    latest_priced_at: string | null;
  };
  variants: PriceVariantTransparency[];
}

export interface RecordPriceOverrideInput {
  mpn: string;
  skuId: string;
  channel: string;
  listingPrice: number;
  reasonCode: string;
  reasonNote?: string | null;
  listingTitle?: string | null;
  listingDescription?: string | null;
}

export function usePriceTransparency(mpn: string | undefined) {
  return useQuery({
    queryKey: priceTransparencyKeys.detail(mpn ?? ''),
    enabled: !!mpn,
    queryFn: async () => invokeWithAuth<PriceTransparencyResult>('admin-data', {
      action: 'get-price-transparency',
      mpn,
    }),
    staleTime: 60_000,
  });
}

export function useRecordPriceOverride() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: RecordPriceOverrideInput) => invokeWithAuth('admin-data', {
      action: 'record-price-override',
      sku_id: input.skuId,
      channel: input.channel,
      listing_price: input.listingPrice,
      reason_code: input.reasonCode,
      reason_note: input.reasonNote ?? undefined,
      listing_title: input.listingTitle ?? undefined,
      listing_description: input.listingDescription ?? undefined,
    }),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: priceTransparencyKeys.detail(variables.mpn) });
      queryClient.invalidateQueries({ queryKey: productKeys.detail(variables.mpn) });
      queryClient.invalidateQueries({ queryKey: channelListingKeys.pricingByVariant(variables.skuId) });
      queryClient.invalidateQueries({ queryKey: ['v2', 'channel-pricing'] });
    },
  });
}
