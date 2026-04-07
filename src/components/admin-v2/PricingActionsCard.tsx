import { useState, useCallback } from 'react';
import { SurfaceCard, SectionHead, Mono } from './ui-primitives';
import { invokeWithAuth } from '@/lib/invokeWithAuth';
import { toast } from 'sonner';
import { Play, Loader2, Search } from 'lucide-react';
import { Progress } from '@/components/ui/progress';

interface BatchResult {
  listing_id: string;
  sku_id: string;
  channel: string;
}

export function PricingActionsCard() {
  const [running, setRunning] = useState(false);
  const [channel, setChannel] = useState('ebay');
  const [progress, setProgress] = useState(0);
  const [total, setTotal] = useState(0);
  const [completed, setCompleted] = useState(0);
  const [errors, setErrors] = useState(0);

  const [singleSku, setSingleSku] = useState('');
  const [singleChannel, setSingleChannel] = useState('ebay');
  const [singleRunning, setSingleRunning] = useState(false);
  const [singleResult, setSingleResult] = useState<Record<string, any> | null>(null);

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
          const pricing = await invokeWithAuth<Record<string, any>>(
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
    if (!singleSku.trim()) {
      toast.error('Enter a SKU code');
      return;
    }

    setSingleRunning(true);
    setSingleResult(null);

    try {
      // Look up the SKU ID by code
      const { supabase } = await import('@/integrations/supabase/client');
      const { data: sku, error } = await (supabase as any)
        .from('sku')
        .select('id, sku_code')
        .eq('sku_code', singleSku.trim())
        .maybeSingle();

      if (error) throw error;
      if (!sku) {
        toast.error(`SKU "${singleSku}" not found`);
        setSingleRunning(false);
        return;
      }

      const pricing = await invokeWithAuth<Record<string, any>>(
        'admin-data',
        { action: 'calculate-selling-costs', sku_id: sku.id, channel: singleChannel }
      );

      setSingleResult(pricing);
      toast.success(`Priced ${sku.sku_code}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed');
    } finally {
      setSingleRunning(false);
    }
  }, [singleSku, singleChannel]);

  return (
    <div className="space-y-4">
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
        <SectionHead>Single SKU Pricing</SectionHead>
        <p className="text-xs text-zinc-500 mt-1 mb-4">
          Calculate pricing for a specific SKU (e.g. 10349-1.1).
        </p>

        <div className="flex items-end gap-3 mb-3">
          <div>
            <label className="text-[10px] text-zinc-500 font-medium uppercase tracking-wider block mb-1">SKU Code</label>
            <input
              type="text"
              value={singleSku}
              onChange={(e) => setSingleSku(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && runSingle()}
              placeholder="e.g. 10349-1.1"
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
            <div className="grid grid-cols-3 gap-2 text-xs">
              <div>
                <span className="text-zinc-500 block text-[10px] uppercase">Floor</span>
                <Mono color="red">£{Number(singleResult.floor_price).toFixed(2)}</Mono>
              </div>
              <div>
                <span className="text-zinc-500 block text-[10px] uppercase">Target</span>
                <Mono color="teal">£{Number(singleResult.target_price).toFixed(2)}</Mono>
              </div>
              <div>
                <span className="text-zinc-500 block text-[10px] uppercase">Ceiling</span>
                <Mono color="amber">£{Number(singleResult.ceiling_price).toFixed(2)}</Mono>
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
              <Mono color={singleResult.confidence_score >= 0.7 ? 'teal' : 'amber'}>
                {(singleResult.confidence_score * 100).toFixed(0)}%
              </Mono>
            </div>
          </div>
        )}
      </SurfaceCard>
    </div>
  );
}
