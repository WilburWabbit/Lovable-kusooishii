

## Channel-Level Auto-Pricing Settings

### What
Per-channel auto-pricing configuration with:
- **Auto-price toggle** per channel (on/off)
- **Max price increase** threshold: percentage AND fixed amount (whichever is hit first prevents update)
- **Max price decrease** threshold: percentage AND fixed amount (separate from increase)

When pricing is calculated and auto-pricing is enabled for that channel, the `listed_price` is updated to `price_target` only if the change falls within the configured thresholds.

### Database

**New table: `channel_pricing_config`**

| Column | Type | Default | Description |
|--------|------|---------|-------------|
| id | uuid | gen_random_uuid() | PK |
| channel | text | NOT NULL, UNIQUE | ebay, bricklink, brickowl, web |
| auto_price_enabled | boolean | false | Toggle |
| max_increase_pct | numeric | NULL | Max allowed increase as decimal (e.g. 0.10 = 10%) |
| max_increase_amount | numeric | NULL | Max allowed increase in £ |
| max_decrease_pct | numeric | NULL | Max allowed decrease as decimal |
| max_decrease_amount | numeric | NULL | Max allowed decrease in £ |
| updated_at | timestamptz | now() | |

RLS: staff/admin ALL (same pattern as other admin tables).

### Edge Function Changes (`admin-data/index.ts`)

1. **New actions**: `list-channel-pricing-config` and `upsert-channel-pricing-config`
2. **Modify `update-listing-prices`**: Accept optional `auto_price: true` param. When set:
   - Look up `channel_pricing_config` for the listing's channel
   - If `auto_price_enabled` is false, skip
   - Compute delta between current `listed_price` and new `price_target`
   - Check delta against thresholds (if both pct and amount are set, the price change must satisfy both -- i.e. not exceed either)
   - If within bounds, set `listed_price = price_target`
   - Add a `pricing_notes` entry indicating whether auto-price was applied or skipped

### Frontend Changes

**1. New settings panel: `ChannelPricingConfigPanel.tsx`**
- Displayed on the Selling Fees settings page alongside existing panels
- One card per channel showing: auto-price toggle, max increase %/£, max decrease %/£
- Uses the new edge function actions to read/write

**2. `ProductDetailAdminPage.tsx`**
- `handleCalculatePricing`: after calculating, pass `auto_price: true` to `update-listing-prices`
- The backend handles all threshold logic

**3. `PricingDashboardPage.tsx`**
- Add channel auto-price status indicators in the filter bar (read-only badges showing which channels have auto-pricing on)

### Flow

```text
Calculate Pricing
  → update-listing-prices(auto_price: true)
  → Backend looks up channel_pricing_config for channel
  → If auto_price_enabled:
      delta = price_target - listed_price
      if delta > 0 (increase):
        ok = (max_increase_pct is null OR delta/listed_price <= max_increase_pct)
             AND (max_increase_amount is null OR delta <= max_increase_amount)
      if delta < 0 (decrease):
        ok = (max_decrease_pct is null OR abs(delta)/listed_price <= max_decrease_pct)
             AND (max_decrease_amount is null OR abs(delta) <= max_decrease_amount)
      if ok: set listed_price = price_target
  → Return result with auto_price_applied: true/false
```

