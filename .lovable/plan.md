

## Per-Channel Selling Cost Model

### What we're building

A system to calculate the **total cost to sell and ship** each SKU on each channel, so the pricing engine (built later) can compute floor prices, margins, and repricing decisions. This implements **section 14.5 (Channel cost model)** from the design spec.

### The cost formula (from the spec)

```text
cost_base =
  carrying_value
  + packaging_cost
  + estimated_standard_delivery_cost
  + estimated_channel_fees
  + estimated_payment_fees
  + risk_reserve
```

### What exists today

- `stock_unit` already has `carrying_value` and `landed_cost`
- `channel_listing` has per-channel listing data but no fee calculations
- No `channel_fee_schedule`, `shipping_rate_table`, or cost calculation logic exists

### Data model: two new tables + one settings table

**1. `channel_fee_schedule`** — stores the fee rules per channel

| Column | Type | Purpose |
|--------|------|---------|
| id | uuid PK | |
| channel | text | ebay, bricklink, brickowl, web |
| fee_name | text | e.g. "Final Value Fee", "Promoted Listing", "PayPal/Managed Payments", "Insertion Fee" |
| rate_percent | numeric | Percentage fee (e.g. 12.8 for eBay FVF) |
| fixed_amount | numeric | Fixed per-transaction fee (e.g. £0.30) |
| min_amount | numeric | Minimum fee if applicable |
| max_amount | numeric | Cap if applicable |
| applies_to | text | "sale_price", "sale_plus_shipping", "sale_price_inc_vat" |
| active | boolean | |
| notes | text | |
| created_at / updated_at | timestamptz | |

**2. `shipping_rate_table`** — estimated outbound shipping costs by weight band

| Column | Type | Purpose |
|--------|------|---------|
| id | uuid PK | |
| channel | text | Channel or "default" |
| carrier | text | e.g. "Royal Mail", "Evri" |
| service_name | text | e.g. "2nd Class Small Parcel" |
| max_weight_kg | numeric | Upper bound of weight band |
| max_length_cm | numeric | Optional dimension limit |
| cost | numeric | Our cost to ship |
| active | boolean | |
| created_at / updated_at | timestamptz | |

**3. `selling_cost_defaults`** — global defaults for packaging and risk reserve

| Column | Type | Purpose |
|--------|------|---------|
| id | uuid PK | |
| key | text UNIQUE | e.g. "packaging_cost", "risk_reserve_rate" |
| value | numeric | |
| updated_at | timestamptz | |

### Backend: cost calculation edge function

A new `calculate-selling-costs` edge function (or action within `admin-data`) that, given a SKU + channel + sale price:

1. Looks up all active `channel_fee_schedule` rows for that channel
2. Computes each fee (rate * applicable base + fixed)
3. Looks up estimated shipping cost from `shipping_rate_table` using the product's weight
4. Adds packaging cost and risk reserve from defaults
5. Returns a breakdown: `{ channel_fees, payment_fees, shipping_cost, packaging_cost, risk_reserve, total_cost_to_sell }`

This can be called per-listing or in bulk for the pricing engine later.

### Frontend: two new Settings panels

**Channel Fee Schedules** — CRUD table within Settings to manage fee rules per channel. Pre-seed with known eBay fees (12.8% FVF + £0.30 per order, ~2% promoted listing optional) and Stripe fees (1.5% + £0.20 for UK cards).

**Shipping Rate Table** — CRUD table to define weight-band shipping costs per carrier/service.

Both follow the existing Settings panel pattern (collapsible cards like QBO/eBay/BrickEconomy panels).

### Changes summary

| File / Area | Change |
|-------------|--------|
| Database migration | Create `channel_fee_schedule`, `shipping_rate_table`, `selling_cost_defaults` tables with staff RLS |
| Database migration | Seed default eBay, Stripe, and web channel fees |
| `supabase/functions/admin-data/index.ts` | Add `calculate-selling-costs` action |
| `src/pages/admin/ChannelFeesSettingsPanel.tsx` | New panel — manage fee schedules |
| `src/pages/admin/ShippingRatesSettingsPanel.tsx` | New panel — manage shipping rate table |
| `src/pages/admin/SettingsPageFull.tsx` | Add both new panels |

