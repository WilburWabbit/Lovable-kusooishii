

## Expand Shipping Rate Table, Import Data, and Auto-Match by Dimensions

### 1. Database Migration — Add columns to `shipping_rate_table`

New columns to match the CSV fields:

| Column | Type | Default | Notes |
|--------|------|---------|-------|
| `size_band` | text | null | "Large Letter", "Small Parcel", etc. |
| `max_girth_cm` | numeric | null | |
| `max_width_cm` | numeric | null | |
| `max_depth_cm` | numeric | null | |
| `price_ex_vat` | numeric | 0 | Our cost excluding VAT |
| `price_inc_vat` | numeric | 0 | Our cost including VAT |
| `vat_exempt` | boolean | false | |
| `tracked` | boolean | false | |
| `max_compensation` | numeric | null | |
| `est_delivery` | text | null | e.g. "2-3 working days" |

Rename existing `cost` → keep as-is but populate with `price_ex_vat` values (the ex-VAT cost is what matters for margin calculation). The `cost` column stays as the canonical cost used in calculations; `price_inc_vat` is stored for reference.

### 2. Seed Data — Insert the 18 CSV rows

Use the insert tool to load all rows from the CSV, mapping fields appropriately. All rows get `channel = 'default'` and `active = true`.

### 3. Update `calculate-selling-costs` — Dimension-aware matching

Current logic only matches on `max_weight_kg`. Updated logic:

1. Query `product` for `weight_kg`, `length_cm`, `width_cm`, `height_cm` (depth)
2. If product has dimensions: filter rates where `max_weight_kg >= weight`, `max_length_cm >= length`, `max_width_cm >= width`, `max_depth_cm >= depth`, then pick the **lowest cost** active rate
3. If product has **no dimensions**: default to the Evri Small Parcel rates, matching on weight only within that carrier+size_band
4. Fallback: if no rate matches, return 0

### 4. Update `upsert-shipping-rate` action

Add the new fields to the upsert action so they're persisted on create/edit.

### 5. Update `ShippingRatesSettingsPanel.tsx`

Expand the table columns and edit dialog to show/edit the new fields: size band, max girth/width/depth, VAT exempt, tracked, max compensation, est. delivery, price ex/inc VAT.

### 6. Update `product` table

Add `width_cm` and `height_cm` columns if not present — checking the schema, `product` already has `width_cm`, `height_cm`, and `length_cm`. Good, no migration needed there.

### Changes Summary

| Area | Change |
|------|--------|
| **DB migration** | Add 10 columns to `shipping_rate_table` |
| **Data insert** | Seed 18 shipping rate rows from CSV |
| **Edge function** | Update upsert action + rewrite shipping cost matching to use dimensions, default to Evri Small Parcel |
| **UI** | Expand `ShippingRatesSettingsPanel` table and edit dialog with new fields |

