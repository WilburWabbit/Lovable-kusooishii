import { useState, useCallback } from 'react';
import { SurfaceCard, SectionHead, Mono } from './ui-primitives';
import { invokeWithAuth } from '@/lib/invokeWithAuth';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Play, Loader2, RefreshCcw, Search, RadioTower } from 'lucide-react';
import { Progress } from '@/components/ui/progress';

interface BatchResult {
  listing_id: string;
  sku_id: string;
  channel: string;
}

interface PricingCalculation {
  sku_id: string;
  sku_code?: string;
  channel: string;
  floor_price: number | null;
  target_price: number | null;
  ceiling_price: number | null;
  estimated_fees?: number | null;
  estimated_net?: number | null;
  confidence_score: number | null;
  market_consensus?: number | null;
  breakdown?: Record<string, number>;
}

type SinglePricingResult = PricingCalculation & { sku_code: string };

interface MarketRefreshSourceResult {
  source: string;
  requested: number;
  inserted: number;
  skipped: number;
  errors?: Array<{ sku: string; error: string }>;
  details?: Record<string, unknown>;
}

interface MarketRefreshResult {
  success: boolean;
  target_count: number;
  sources: string[];
  results: MarketRefreshSourceResult[];
  snapshot_rows: number;
}

interface MarketSummary {
  signal_count: number;
  snapshot_count: number;
  latest_observed_at: string | null;
  latest_captured_at: string | null;
  average_confidence: number | null;
  average_freshness: number | null;
  source_counts: Record<string, number>;
  consensus: {
    price: number | null;
    channel: string | null;
    confidence_score: number | null;
    freshness_score: number | null;
    sample_size: number | null;
    captured_at: string | null;
  } | null;
}

const MARKET_SOURCES = [
  { code: 'ebay_sold', label: 'eBay sold' },
  { code: 'bricklink_price_guide', label: 'BrickLink solds' },
  { code: 'brickowl_availability', label: 'BrickOwl asks' },
  { code: 'brickeconomy', label: 'BrickEconomy cache' },
] as const;

function formatPercent(value: number | null | undefined) {
  if (value == null || !Number.isFinite(Number(value))) return 'n/a';
  return `${Math.round(Number(value) * 100)}%`;
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return 'n/a';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'n/a';
  return date.toLocaleString(undefined, {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function confidenceTone(value: number | null | undefined): 'teal' | 'amber' | 'red' {
  const n = Number(value ?? 0);
  if (n >= 0.7) return 'teal';
  if (n >= 0.45) return 'amber';
  return 'red';
}

function baseMpn(mpn: string) {
  return mpn.trim().replace(/-\d+$/, '');
}

export function PricingActionsCard() {
  const [running, setRunning] = useState(false);
  const [channel, setChannel] = useState('ebay');
  const [progress, setProgress] = useState(0);
  const [total, setTotal] = useState(0);
  const [completed, setCompleted] = useState(0);
  const [errors, setErrors] = useState(0);

  const [singleMpn, setSingleMpn] = useState('');
  const [singleChannel, setSingleChannel] = useState('ebay');
  const [singleRunning, setSingleRunning] = useState(false);
  const [singleResults, setSingleResults] = useState<SinglePricingResult[]>([]);
  const [marketRefreshRunning, setMarketRefreshRunning] = useState(false);
  const [marketRefreshCount, setMarketRefreshCount] = useState<number | null>(null);
  const [marketSignalsRunning, setMarketSignalsRunning] = useState(false);
  const [marketRefreshResult, setMarketRefreshResult] = useState<MarketRefreshResult | null>(null);
  const [marketSummary, setMarketSummary] = useState<MarketSummary | null>(null);

  const loadMarketSummary = useCallback(async (skuIds?: string | string[]) => {
    const ids = Array.isArray(skuIds) ? skuIds.filter(Boolean) : skuIds ? [skuIds] : [];
    const signalQuery = supabase
      .from('market_signal')
      .select('source_confidence, freshness_score, observed_at, source:source_id(source_code)' as never)
      .order('observed_at', { ascending: false })
      .limit(250);

    if (ids.length === 1) signalQuery.eq('sku_id', ids[0]);
    if (ids.length > 1) signalQuery.in('sku_id' as never, ids as never);

    const snapshotQuery = supabase
      .from('market_price_snapshot')
      .select('price, channel, confidence_score, freshness_score, sample_size, captured_at, source:source_id(source_code)' as never)
      .order('captured_at', { ascending: false })
      .limit(100);

    if (ids.length === 1) snapshotQuery.eq('sku_id', ids[0]);
    if (ids.length > 1) snapshotQuery.in('sku_id' as never, ids as never);

    const [signalResult, snapshotResult] = await Promise.all([signalQuery, snapshotQuery]);
    if (signalResult.error) throw signalResult.error;
    if (snapshotResult.error) throw snapshotResult.error;

    type SignalRow = {
      source_confidence: number | string | null;
      freshness_score: number | string | null;
      observed_at: string | null;
      source?: { source_code?: string | null } | Array<{ source_code?: string | null }>;
    };
    type SnapshotRow = {
      price: number | string | null;
      channel: string | null;
      confidence_score: number | string | null;
      freshness_score: number | string | null;
      sample_size: number | string | null;
      captured_at: string | null;
      source?: { source_code?: string | null } | Array<{ source_code?: string | null }>;
    };

    const signals = (signalResult.data ?? []) as unknown as SignalRow[];
    const snapshots = (snapshotResult.data ?? []) as unknown as SnapshotRow[];
    const sourceCounts: Record<string, number> = {};
    let confidenceTotal = 0;
    let freshnessTotal = 0;
    let confidenceCount = 0;
    let freshnessCount = 0;

    for (const signal of signals) {
      const source = Array.isArray(signal.source) ? signal.source[0] : signal.source;
      const code = source?.source_code ?? 'unknown';
      sourceCounts[code] = (sourceCounts[code] ?? 0) + 1;
      const confidence = Number(signal.source_confidence);
      const freshness = Number(signal.freshness_score);
      if (Number.isFinite(confidence)) {
        confidenceTotal += confidence;
        confidenceCount++;
      }
      if (Number.isFinite(freshness)) {
        freshnessTotal += freshness;
        freshnessCount++;
      }
    }

    const consensusSnapshot = snapshots.find((snapshot) => {
      const source = Array.isArray(snapshot.source) ? snapshot.source[0] : snapshot.source;
      return source?.source_code === 'market_consensus';
    }) ?? snapshots[0] ?? null;

    setMarketSummary({
      signal_count: signals.length,
      snapshot_count: snapshots.length,
      latest_observed_at: signals[0]?.observed_at ?? null,
      latest_captured_at: snapshots[0]?.captured_at ?? null,
      average_confidence: confidenceCount > 0 ? confidenceTotal / confidenceCount : null,
      average_freshness: freshnessCount > 0 ? freshnessTotal / freshnessCount : null,
      source_counts: sourceCounts,
      consensus: consensusSnapshot
        ? {
            price: consensusSnapshot.price == null ? null : Number(consensusSnapshot.price),
            channel: consensusSnapshot.channel,
            confidence_score: consensusSnapshot.confidence_score == null ? null : Number(consensusSnapshot.confidence_score),
            freshness_score: consensusSnapshot.freshness_score == null ? null : Number(consensusSnapshot.freshness_score),
            sample_size: consensusSnapshot.sample_size == null ? null : Number(consensusSnapshot.sample_size),
            captured_at: consensusSnapshot.captured_at,
          }
        : null,
    });
  }, []);

  const findSkusForMpn = useCallback(async (mpnInput: string): Promise<Array<{ id: string; sku_code: string }>> => {
    const wanted = mpnInput.trim();
    const wantedBase = baseMpn(wanted);
    const { data: products, error: productError } = await supabase
      .from('product')
      .select('id, mpn' as never)
      .or(`mpn.eq.${wanted},mpn.like.${wantedBase}-%` as never)
      .limit(25);
    if (productError) throw productError;

    const productIds = ((products ?? []) as unknown as Array<{ id: string }>).map((product) => product.id);
    let productSkus: Array<{ id: string; sku_code: string }> = [];
    if (productIds.length > 0) {
      const { data: skus, error } = await supabase
        .from('sku')
        .select('id, sku_code, condition_grade' as never)
        .in('product_id' as never, productIds as never)
        .eq('active_flag' as never, true as never)
        .order('sku_code' as never, { ascending: true } as never);
      if (error) throw error;
      productSkus = (skus ?? []) as unknown as Array<{ id: string; sku_code: string }>;
    }

    const { data: fallbackSkus, error } = await supabase
      .from('sku')
      .select('id, sku_code, condition_grade' as never)
      .or(`mpn.eq.${wanted},sku_code.like.${wanted}.%` as never)
      .eq('active_flag' as never, true as never)
      .order('sku_code' as never, { ascending: true } as never);
    if (error) throw error;
    const byId = new Map<string, { id: string; sku_code: string }>();
    for (const sku of productSkus) byId.set(sku.id, sku);
    for (const sku of ((fallbackSkus ?? []) as unknown as Array<{ id: string; sku_code: string }>)) {
      byId.set(sku.id, sku);
    }
    return [...byId.values()].sort((a, b) => a.sku_code.localeCompare(b.sku_code, undefined, { numeric: true }));
  }, []);

  const refreshMarketSnapshots = useCallback(async () => {
    setMarketRefreshRunning(true);

    try {
      const { data, error } = await supabase.rpc('refresh_market_price_snapshots' as never);
      if (error) throw error;

      const count = Number(data ?? 0);
      setMarketRefreshCount(count);
      await loadMarketSummary();
      toast.success(`Refreshed ${count} market pricing record(s)`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Market snapshot refresh failed');
    } finally {
      setMarketRefreshRunning(false);
    }
  }, [loadMarketSummary]);

  const refreshMarketSignals = useCallback(async (onlySingleMpn = false) => {
    setMarketSignalsRunning(true);

    try {
      const mpn = onlySingleMpn ? singleMpn.trim() : '';
      if (onlySingleMpn && !mpn) {
        toast.error('Enter an MPN before refreshing a single product');
        return;
      }

      const result = await invokeWithAuth<MarketRefreshResult>(
        'market-intelligence-refresh',
        {
          mpn: mpn || undefined,
          sources: MARKET_SOURCES.map((source) => source.code),
          limit: onlySingleMpn ? 25 : 75,
          refresh_snapshots: true,
        }
      );

      setMarketRefreshResult(result);
      setMarketRefreshCount(result.snapshot_rows);
      if (onlySingleMpn && result.target_count === 0) {
        toast.warning(`No active SKU found for MPN "${mpn}"`);
        await loadMarketSummary();
        return;
      }
      if (onlySingleMpn && mpn) {
        const skus = await findSkusForMpn(mpn);
        await loadMarketSummary(skus.map((sku) => sku.id));
      } else {
        await loadMarketSummary();
      }

      const inserted = result.results.reduce((sum, row) => sum + row.inserted, 0);
      const errors = result.results.reduce((sum, row) => sum + (row.errors?.length ?? 0), 0);
      if (errors > 0) {
        toast.warning(`Refreshed ${inserted} market signal(s), with ${errors} source issue(s)`);
      } else {
        toast.success(`Refreshed ${inserted} market signal(s)`);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Market signal refresh failed');
    } finally {
      setMarketSignalsRunning(false);
    }
  }, [findSkusForMpn, loadMarketSummary, singleMpn]);

  const runAll = useCallback(async () => {
    setRunning(true);
    setProgress(0);
    setCompleted(0);
    setErrors(0);
    setTotal(0);

    try {
      // 1. Get batch of listings to price
      const batch = await invokeWithAuth<{ listings: BatchResult[]; total: number }>(
        'admin-data',
        { action: 'batch-calculate-pricing', channel }
      );

      const listings = batch?.listings ?? [];
      setTotal(listings.length);

      if (listings.length === 0) {
        toast.info('No SKUs to price');
        setRunning(false);
        return;
      }

      let done = 0;
      let errCount = 0;

      // 2. Process each listing: calculate → update
      for (const listing of listings) {
        try {
          const pricing = await invokeWithAuth<PricingCalculation>(
            'admin-data',
            { action: 'calculate-pricing', sku_id: listing.sku_id, channel: listing.channel }
          );

          if (pricing?.floor_price != null) {
            await invokeWithAuth('admin-data', {
              action: 'update-listing-prices',
              listing_id: listing.listing_id,
              price_floor: pricing.floor_price,
              price_target: pricing.target_price,
              price_ceiling: pricing.ceiling_price,
              confidence_score: pricing.confidence_score,
              pricing_notes: `Floor: £${pricing.floor_price}, Target: £${pricing.target_price}, Ceiling: £${pricing.ceiling_price}`,
              auto_price: true,
            });
          }
        } catch (err) {
          errCount++;
          console.error(`Pricing error for SKU ${listing.sku_id}:`, err);
        }

        done++;
        setCompleted(done);
        setErrors(errCount);
        setProgress(Math.round((done / listings.length) * 100));
      }

      toast.success(`Priced ${done - errCount}/${listings.length} SKUs${errCount > 0 ? ` (${errCount} errors)` : ''}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Batch pricing failed');
    } finally {
      setRunning(false);
    }
  }, [channel]);

  const runSingle = useCallback(async () => {
    if (!singleMpn.trim()) {
      toast.error('Enter an MPN');
      return;
    }

    setSingleRunning(true);
    setSingleResults([]);

    try {
      const skus = await findSkusForMpn(singleMpn.trim());
      if (skus.length === 0) {
        toast.error(`No active SKU found for MPN "${singleMpn}"`);
        setSingleRunning(false);
        return;
      }

      const results: SinglePricingResult[] = [];
      for (const sku of skus) {
        const pricing = await invokeWithAuth<PricingCalculation>(
          'admin-data',
          { action: 'calculate-pricing', sku_id: sku.id, channel: singleChannel }
        );
        results.push({ ...pricing, sku_code: sku.sku_code });
      }

      setSingleResults(results);
      await loadMarketSummary(skus.map((sku) => sku.id));
      toast.success(`Priced ${results.length} SKU${results.length === 1 ? '' : 's'} for ${singleMpn.trim()}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed');
    } finally {
      setSingleRunning(false);
    }
  }, [findSkusForMpn, singleMpn, singleChannel, loadMarketSummary]);

  return (
    <div className="space-y-4">
      {/* Market intelligence */}
      <SurfaceCard>
        <SectionHead>Market Intelligence</SectionHead>
        <p className="text-xs text-zinc-500 mt-1 mb-4">
          Refresh real source signals, rebuild weighted consensus, and inspect whether pricing is relying on fresh evidence.
        </p>

        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="text-[10px] text-zinc-500 font-medium uppercase tracking-wider block mb-1">MPN</label>
            <input
              type="text"
              value={singleMpn}
              onChange={(e) => setSingleMpn(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && refreshMarketSignals(true)}
              placeholder="e.g. 10349-1"
              disabled={marketSignalsRunning || marketRefreshRunning}
              className="w-36 px-2 py-1.5 text-xs border border-zinc-200 rounded bg-white font-mono"
            />
          </div>

          <button
            onClick={() => refreshMarketSignals(false)}
            disabled={marketSignalsRunning || marketRefreshRunning}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded bg-zinc-800 text-zinc-50 hover:bg-zinc-700 disabled:opacity-50 transition-colors"
          >
            {marketSignalsRunning ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RadioTower className="h-3.5 w-3.5" />}
            {marketSignalsRunning ? 'Refreshing...' : 'Refresh Source Signals'}
          </button>

          <button
            onClick={() => refreshMarketSignals(true)}
            disabled={marketSignalsRunning || marketRefreshRunning || !singleMpn.trim()}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded border border-zinc-300 bg-white text-zinc-800 hover:bg-zinc-50 disabled:opacity-50 transition-colors"
          >
            {marketSignalsRunning ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
            Single MPN Signals
          </button>

          <button
            onClick={refreshMarketSnapshots}
            disabled={marketRefreshRunning || marketSignalsRunning}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded border border-zinc-300 bg-white text-zinc-800 hover:bg-zinc-50 disabled:opacity-50 transition-colors"
          >
            {marketRefreshRunning ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCcw className="h-3.5 w-3.5" />}
            {marketRefreshRunning ? 'Refreshing...' : 'Rebuild Consensus Only'}
          </button>

          {marketRefreshCount != null && (
            <div className="text-[11px] text-zinc-500">
              Last refresh created <Mono color="teal">{marketRefreshCount}</Mono> signal/snapshot row(s)
            </div>
          )}
        </div>

        {marketRefreshResult && (
          <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {marketRefreshResult.results.map((row) => (
              <div key={row.source} className="rounded border border-zinc-200 bg-zinc-50 px-3 py-2">
                <div className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                  {MARKET_SOURCES.find((source) => source.code === row.source)?.label ?? row.source.replace(/_/g, ' ')}
                </div>
                <div className="mt-1 flex items-center justify-between text-[11px]">
                  <span className="text-zinc-500">Signals</span>
                  <Mono color={row.inserted > 0 ? 'teal' : 'amber'}>{row.inserted}</Mono>
                </div>
                <div className="flex items-center justify-between text-[11px]">
                  <span className="text-zinc-500">Skipped</span>
                  <Mono>{row.skipped}</Mono>
                </div>
                {(row.errors?.length ?? 0) > 0 && (
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="text-zinc-500">Issues</span>
                    <Mono color="red">{row.errors?.length ?? 0}</Mono>
                  </div>
                )}
                {row.details?.configured === false && (
                  <div className="mt-1 text-[10px] text-amber-700">Credentials not configured</div>
                )}
              </div>
            ))}
          </div>
        )}

        {marketSummary && (
          <div className="mt-3 rounded border border-zinc-200 bg-white px-3 py-2">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5 text-[11px]">
              <div>
                <span className="text-zinc-500 block text-[10px] uppercase">Latest Signal</span>
                <Mono>{formatDateTime(marketSummary.latest_observed_at)}</Mono>
              </div>
              <div>
                <span className="text-zinc-500 block text-[10px] uppercase">Avg Confidence</span>
                <Mono color={confidenceTone(marketSummary.average_confidence)}>
                  {formatPercent(marketSummary.average_confidence)}
                </Mono>
              </div>
              <div>
                <span className="text-zinc-500 block text-[10px] uppercase">Avg Freshness</span>
                <Mono color={confidenceTone(marketSummary.average_freshness)}>
                  {formatPercent(marketSummary.average_freshness)}
                </Mono>
              </div>
              <div>
                <span className="text-zinc-500 block text-[10px] uppercase">Consensus</span>
                <Mono color={confidenceTone(marketSummary.consensus?.confidence_score)}>
                  {marketSummary.consensus?.price != null ? `£${marketSummary.consensus.price.toFixed(2)}` : 'n/a'}
                </Mono>
              </div>
              <div>
                <span className="text-zinc-500 block text-[10px] uppercase">Sources</span>
                <Mono color="teal">{Object.keys(marketSummary.source_counts).length}</Mono>
              </div>
            </div>
            {Object.keys(marketSummary.source_counts).length > 0 && (
              <div className="mt-2 flex flex-wrap gap-2 text-[10px] text-zinc-500">
                {Object.entries(marketSummary.source_counts).map(([source, count]) => (
                  <span key={source} className="rounded border border-zinc-200 bg-zinc-50 px-2 py-0.5">
                    {source.replace(/_/g, ' ')}: <Mono>{count}</Mono>
                  </span>
                ))}
              </div>
            )}
          </div>
        )}
      </SurfaceCard>

      {/* Batch pricing */}
      <SurfaceCard>
        <SectionHead>Batch Price Calculation</SectionHead>
        <p className="text-xs text-zinc-500 mt-1 mb-4">
          Recalculate floor, target, and ceiling prices for all active SKUs on a channel.
        </p>

        <div className="flex items-end gap-3 mb-3">
          <div>
            <label className="text-[10px] text-zinc-500 font-medium uppercase tracking-wider block mb-1">Channel</label>
            <select
              value={channel}
              onChange={(e) => setChannel(e.target.value)}
              disabled={running}
              className="px-2 py-1.5 text-xs border border-zinc-200 rounded bg-white"
            >
              <option value="ebay">eBay</option>
              <option value="web">Web</option>
              <option value="bricklink">BrickLink</option>
              <option value="brickowl">BrickOwl</option>
            </select>
          </div>

          <button
            onClick={runAll}
            disabled={running}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded bg-amber-500 text-zinc-900 hover:bg-amber-400 disabled:opacity-50 transition-colors"
          >
            {running ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
            {running ? 'Running...' : 'Run All Pricing'}
          </button>
        </div>

        {running && (
          <div className="space-y-2">
            <Progress value={progress} className="h-2" />
            <div className="flex gap-4 text-[11px] text-zinc-500">
              <span>Progress: <Mono color="teal">{completed}/{total}</Mono></span>
              {errors > 0 && <span>Errors: <Mono color="red">{errors}</Mono></span>}
            </div>
          </div>
        )}

        {!running && completed > 0 && (
          <div className="text-[11px] text-zinc-500 mt-2">
            Last run: <Mono color="teal">{completed - errors}</Mono> priced
            {errors > 0 && <>, <Mono color="red">{errors}</Mono> errors</>}
            {' '}out of {total}
          </div>
        )}
      </SurfaceCard>

      {/* Single SKU pricing */}
      <SurfaceCard>
        <SectionHead>Single MPN Pricing</SectionHead>
        <p className="text-xs text-zinc-500 mt-1 mb-4">
          Calculate pricing for the first active SKU attached to an MPN.
        </p>

        <div className="flex items-end gap-3 mb-3">
          <div>
            <label className="text-[10px] text-zinc-500 font-medium uppercase tracking-wider block mb-1">MPN</label>
            <input
              type="text"
              value={singleMpn}
              onChange={(e) => setSingleMpn(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && runSingle()}
              placeholder="e.g. 10349-1"
              disabled={singleRunning}
              className="w-36 px-2 py-1.5 text-xs border border-zinc-200 rounded bg-white font-mono"
            />
          </div>
          <div>
            <label className="text-[10px] text-zinc-500 font-medium uppercase tracking-wider block mb-1">Channel</label>
            <select
              value={singleChannel}
              onChange={(e) => setSingleChannel(e.target.value)}
              disabled={singleRunning}
              className="px-2 py-1.5 text-xs border border-zinc-200 rounded bg-white"
            >
              <option value="ebay">eBay</option>
              <option value="web">Web</option>
              <option value="bricklink">BrickLink</option>
              <option value="brickowl">BrickOwl</option>
            </select>
          </div>

          <button
            onClick={runSingle}
            disabled={singleRunning}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded bg-zinc-800 text-zinc-50 hover:bg-zinc-700 disabled:opacity-50 transition-colors"
          >
            {singleRunning ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
            {singleRunning ? 'Calculating...' : 'Calculate'}
          </button>
        </div>

        {singleResult && (
          <div className="mt-3 p-3 rounded bg-zinc-50 border border-zinc-200">
            <div className="grid gap-2 text-xs sm:grid-cols-4">
              <div>
                <span className="text-zinc-500 block text-[10px] uppercase">Floor</span>
                <Mono color="red">£{Number(singleResult.floor_price ?? 0).toFixed(2)}</Mono>
              </div>
              <div>
                <span className="text-zinc-500 block text-[10px] uppercase">Target</span>
                <Mono color="teal">£{Number(singleResult.target_price ?? 0).toFixed(2)}</Mono>
              </div>
              <div>
                <span className="text-zinc-500 block text-[10px] uppercase">Ceiling</span>
                <Mono color="amber">£{Number(singleResult.ceiling_price ?? 0).toFixed(2)}</Mono>
              </div>
              <div>
                <span className="text-zinc-500 block text-[10px] uppercase">Market</span>
                <Mono color={singleResult.market_consensus != null ? 'teal' : 'amber'}>
                  {singleResult.market_consensus != null ? `£${Number(singleResult.market_consensus).toFixed(2)}` : 'n/a'}
                </Mono>
              </div>
            </div>

            {singleResult.breakdown && (
              <div className="mt-3 pt-2 border-t border-zinc-200 space-y-1">
                <div className="text-[10px] text-zinc-500 font-semibold uppercase tracking-wider mb-1">Breakdown</div>
                {Object.entries(singleResult.breakdown as Record<string, number>).map(([k, v]) => (
                  <div key={k} className="flex justify-between text-[11px]">
                    <span className="text-zinc-500">{k.replace(/_/g, ' ')}</span>
                    <span className="font-mono text-zinc-700">
                      {k.includes('rate') || k.includes('margin') ? `${v}%` : `£${Number(v).toFixed(2)}`}
                    </span>
                  </div>
                ))}
              </div>
            )}

            <div className="mt-2 pt-2 border-t border-zinc-200 flex justify-between text-[11px]">
              <span className="text-zinc-500">Confidence</span>
              <Mono color={(singleResult.confidence_score ?? 0) >= 0.7 ? 'teal' : 'amber'}>
                {((singleResult.confidence_score ?? 0) * 100).toFixed(0)}%
              </Mono>
            </div>
          </div>
        )}
      </SurfaceCard>
    </div>
  );
}
