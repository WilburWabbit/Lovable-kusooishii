

# Fix Floor Price Calculations: VAT Netting + Auto-Markdown Fee Access

## Clarification

The pricing engine (`admin-data/index.ts`) **does** already query `channel_fee_schedule` and `shipping_rate_table` — the fee schedule data is available. The two problems are:

1. **The floor formula ignores output VAT** — it treats the full gross price as available revenue, but only `price / 1.2` is actual revenue after VAT. The denominator on line 945 should subtract the VAT take.

2. **Auto-markdown uses a naive `cost × 1.25` floor** (line 147) instead of querying the fee schedule and shipping rates like the pricing engine does.

## Changes

### 1. `supabase/functions/admin-data/index.ts` — Fix floor formula for VAT

Current (line 945-946):
```typescript
const denominator = Math.max(1 - effectiveMargin - effectiveFeeRate - riskRate, 0.05);
let floorPrice = (costBase + minProfit + fixedFeeCosts) / denominator;
```

The formula solves `price - margin×price - fees×price - risk×price = costBase + minProfit + fixedFees`, treating `price` as revenue. But revenue is actually `price / 1.2`.

Fix: multiply the revenue side by `1/1.2` and net the fee rates through VAT too (since fee VAT is reclaimable):

```typescript
// Revenue from price P is P/1.2 (output VAT goes to HMRC)
// Fee cost from price P is feeRate×P/1.2 (input VAT reclaimable)
// Equation: P/1.2 - margin×(P/1.2) - feeRate×P/1.2 - risk×(P/1.2) >= costBase + minProfit + fixedFees/1.2
// Solve: P >= 1.2 × (costBase + minProfit + netFixedFees) / (1 - margin - effectiveFeeRate - riskRate)
const netFixedFees = fixedFeeCosts / 1.2;
const denominator = Math.max(1 - effectiveMargin - effectiveFeeRate - riskRate, 0.05);
let floorPrice = Math.round((1.2 * (costBase + minProfit + netFixedFees) / denominator) * 100) / 100;
```

Also fix the post-check loop (lines 949-964) to compare against ex-VAT revenue:
```typescript
const requiredRevenue = costBase + minProfit + (totalFees / 1.2) + riskReserve;
const neededPrice = 1.2 * requiredRevenue / (1 - effectiveMargin);
```

### 2. `supabase/functions/auto-markdown-prices/index.ts` — Use real fees and shipping

Replace the naive `cost × (1 + MARGIN_TARGET)` floor with a proper calculation that:
- Queries `channel_fee_schedule` for the listing's channel (eBay by default for listed items)
- Queries `shipping_rate_table` for estimated shipping cost
- Queries `selling_cost_defaults` for packaging and risk reserve
- Applies the same VAT-aware floor formula as the pricing engine

This means extracting the floor calculation into a shared helper or inlining the same logic. The function already has the `admin` client, so it just needs the additional queries per SKU group.

### 3. Shared floor calculation helper

To avoid duplicating the formula, extract a `calculateFloorPrice` function into `supabase/functions/_shared/pricing.ts`:

```typescript
export function calculateFloorPrice(params: {
  costBase: number;        // carrying_value + packaging + shipping (all ex-VAT)
  minProfit: number;
  effectiveFeeRate: number; // aggregated rate from fee schedule
  fixedFeeCosts: number;    // aggregated fixed fees
  riskRate: number;
  minMargin: number;
  fees: FeeScheduleRow[];   // for post-check iteration
  shippingCost: number;
}): number
```

Both `admin-data` and `auto-markdown-prices` call this shared function.

## Files changed

| File | Change |
|------|--------|
| `supabase/functions/_shared/pricing.ts` | New shared floor price calculator with VAT netting |
| `supabase/functions/admin-data/index.ts` | Use shared calculator; fix floor formula and post-check |
| `supabase/functions/auto-markdown-prices/index.ts` | Replace `cost × 1.25` with real fee/shipping/VAT-aware floor |

## Expected outcome

For the 10349-1.1 example (cost £9.03 ex-VAT, eBay channel ~15% fees):
- Old floor: £11.29 (`9.03 × 1.25`, ignores fees and VAT)
- New floor: ~£17-18 (ensures `price/1.2 - fees/1.2 - shipping - packaging - risk >= cost + minProfit`)
- A sale at £15.99 would correctly show as below floor, preventing loss-making listings

