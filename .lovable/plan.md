

# Revamp Shipping Rates: Evri-First Strategy + International Rates

## Summary

All orders — including eBay — should default to Evri direct shipping to accumulate volume for higher tier discounts. eBay-specific carrier rates are only used when they offer a substantial saving or when the order value warrants Royal Mail's higher insurance. Evri international rates are added as a new data set.

## Shipping selection logic

```text
For any order/pricing calculation:
1. Look up Evri direct rate (filtered by active tier) for the item's weight/dimensions
2. Look up eBay carrier rate (if channel is eBay)
3. Use Evri direct UNLESS:
   a. eBay carrier rate is cheaper by > £1.00 (configurable threshold)
   b. OR sale price > £100 (configurable) AND Royal Mail tracked/insured option exists
4. For international orders, use Evri international rates (or Royal Mail if value warrants it)
```

## Data changes

### Migration: Add `tier` column + new settings keys

- Add `tier TEXT` (nullable) to `shipping_rate_table`
- Add `destination` column (`domestic` | `international`, default `domestic`)

### Data insert: Full Evri rate cards

**Evri Domestic (channel: `default`)** — 3 tiers per band:
- Postable (≤1kg, 35×23×3cm): Tier 1 £2.39, Tier 2 £2.30, Tier 3 £2.20
- Small ≤1kg (45×35×16cm): Tier 1 £2.59, Tier 2 £2.50, Tier 3 £2.40
- Small ≤2kg: Tier 1 £2.79, Tier 2 £2.69, Tier 3 £2.59
- Medium ≤5kg (120×60×60cm): Tier 1 £3.49, Tier 2 £3.35, Tier 3 £3.22
- Medium ≤10kg: Tier 1 £5.49, Tier 2 £5.27, Tier 3 £5.06
- Large ≤15kg: Tier 1 £8.49, Tier 2 £8.15, Tier 3 £7.82
- XL ≤30kg (120×80×80cm): Tier 1 £15.99, Tier 2 £15.00, Tier 3 £14.50

**Evri International** (channel: `default`, destination: `international`) — from Evri's international rate card (to be confirmed/entered via UI).

**eBay carrier rates** (channel: `ebay`) — from the uploaded eBay image:
- Evri ParcelShop rates, InPost, DPD, UPS, Yodel, DHL, Royal Mail

### Settings keys in `selling_cost_defaults`

- `evri_active_tier` — `tier_1` / `tier_2` / `tier_3`
- `evri_tier_1_threshold` — e.g. 0 (default)
- `evri_tier_2_threshold` — e.g. 200
- `evri_tier_3_threshold` — e.g. 500
- `shipping_prefer_evri_threshold` — price difference (£) below which Evri direct is preferred over eBay carrier (default: 1.00)
- `high_value_order_threshold` — order value (£) above which Royal Mail insured is considered (default: 100)

## Pricing engine changes

### `supabase/functions/admin-data/index.ts` (~line 865)

Replace the current "cheapest rate" logic with the Evri-first strategy:

1. Read `evri_active_tier` from `selling_cost_defaults`
2. Query Evri direct rates: `channel = 'default'`, `tier = active_tier`, `destination = 'domestic'`
3. Find best-fit Evri rate by weight + dimensions
4. If channel is `ebay`:
   - Query eBay carrier rates (`channel = 'ebay'`)
   - Find best-fit eBay rate
   - Only use eBay rate if it saves more than `shipping_prefer_evri_threshold`
   - If sale estimate > `high_value_order_threshold`, check for Royal Mail tracked option
5. Return selected rate as `shippingCost`

### `supabase/functions/auto-markdown-prices/index.ts`

Same tier-aware + Evri-first filtering.

## UI changes

### `src/pages/admin-v2/ShippingRatesPage.tsx`

- Group rates by: Evri Domestic (with tier columns side-by-side), Evri International, eBay Carriers
- Show active tier badge
- Add destination filter/indicator

### `src/hooks/admin/use-shipping-rates.ts`

- Add `tier` and `destination` to `ShippingRate` interface

### `src/components/admin-v2/PricingSettingsCard.tsx`

- New settings rows for tier thresholds, Evri preference threshold, and high-value order threshold will appear automatically via `selling_cost_defaults`

## Files changed

| File | Change |
|------|--------|
| **Migration** | Add `tier` and `destination` columns to `shipping_rate_table` |
| **Data insert** | Full Evri 3-tier domestic + international rates, eBay carrier rates, new settings keys |
| `src/hooks/admin/use-shipping-rates.ts` | Add `tier`, `destination` to interface |
| `src/hooks/admin/use-selling-cost-defaults.ts` | Add labels for new settings keys |
| `src/pages/admin-v2/ShippingRatesPage.tsx` | Grouped display with tier comparison, destination grouping |
| `supabase/functions/admin-data/index.ts` | Evri-first shipping selection with configurable thresholds |
| `supabase/functions/auto-markdown-prices/index.ts` | Same Evri-first logic |

