

## Phase 1 Pricing Engine

Build the pricing engine that computes floor, target, and ceiling prices per SKU per channel, using the existing cost model and BrickEconomy data as a market baseline.

### The Formulas (from spec §14.5)

```text
floor_price  = (cost_base + min_profit_amount) / (1 - min_margin_rate)
target_price = market_consensus * condition_multiplier
ceiling_price = max(floor_price, strategic_hold_value)
```

### 1. Database Migration

**Add pricing config defaults** to `selling_cost_defaults` (seed via insert tool):

| Key | Default Value | Purpose |
|-----|--------------|---------|
| `minimum_profit_amount` | 1.00 | Min £ profit per sale |
| `minimum_margin_rate` | 0.15 | Min 15% margin rate |
| `condition_multiplier_1` | 1.00 | Grade 1 (sealed/new) |
| `condition_multiplier_2` | 0.90 | Grade 2 (complete, opened) |
| `condition_multiplier_3` | 0.75 | Grade 3 (minor issues) |
| `condition_multiplier_4` | 0.55 | Grade 4 (incomplete/damaged) |

**Add pricing columns to `channel_listing`**:

| Column | Type | Default |
|--------|------|---------|
| `price_floor` | numeric | null |
| `price_target` | numeric | null |
| `price_ceiling` | numeric | null |
| `confidence_score` | numeric | null |
| `pricing_notes` | text | null |
| `priced_at` | timestamptz | null |

### 2. Backend — `calculate-pricing` Action in `admin-data`

New action that, given a `sku_id` and `channel`:

1. Calls the existing `calculate-selling-costs` logic internally to get `total_cost_to_sell`
2. Reads `minimum_profit_amount` and `minimum_margin_rate` from defaults
3. Computes `floor_price = (cost_base + min_profit) / (1 - min_margin_rate)`
4. Looks up BrickEconomy valuation for the product's MPN as `market_consensus`
5. Applies `condition_multiplier` based on the SKU's condition grade
6. Computes `target_price = market_consensus * condition_multiplier`
7. Computes `ceiling_price = max(floor_price, market_consensus)`
8. Assigns confidence score (high if BE data exists + stock exists, low if missing data)
9. Returns `{ floor_price, target_price, ceiling_price, cost_base, confidence_score, breakdown }`

Also add a `batch-calculate-pricing` action that runs this for all active listings on a given channel (or all channels).

### 3. Backend — `update-listing-prices` Action

Persists the computed prices back to `channel_listing`:
- Updates `price_floor`, `price_target`, `price_ceiling`, `confidence_score`, `priced_at`
- Optionally updates `listed_price` if auto-pricing is enabled

### 4. Frontend — Pricing Column on Listings/Products Pages

Add pricing data visibility to the existing product detail admin page:
- Show floor / target / ceiling alongside current listed price
- Add a "Calculate Prices" button that triggers pricing for a SKU
- Show confidence score as a badge (High/Medium/Low)

### 5. Frontend — `SellingCostDefaultsPanel` Update

Add the new pricing config keys to the `LABELS` map so they appear in the Selling Fees settings page for editing:
- `minimum_profit_amount`, `minimum_margin_rate`
- `condition_multiplier_1` through `condition_multiplier_4`

### Changes Summary

| Area | Change |
|------|--------|
| DB migration | Add 6 columns to `channel_listing` |
| Data insert | Seed 6 new keys in `selling_cost_defaults` |
| Edge function | Add `calculate-pricing`, `batch-calculate-pricing`, `update-listing-prices` actions |
| `SellingCostDefaultsPanel.tsx` | Expand LABELS to show pricing config defaults |
| `ProductDetailAdminPage.tsx` | Show pricing breakdown per SKU/channel listing |

