

# Add CRUD for Channel Fees, Shipping Rates, and Selling Cost Defaults

## Problem

The pricing engine relies on three configuration tables — `channel_fee_schedule`, `shipping_rate_table`, and `selling_cost_defaults` — but there is no UI to manage them. Currently they can only be edited via direct database access. The existing `PricingSettingsCard` only covers the `pricing_settings` table (markdown thresholds and margin targets).

## Data already in place

All three tables exist with correct schemas and RLS policies (staff/admin ALL access). No migrations needed.

- **`channel_fee_schedule`** (5 rows): channel, fee_name, rate_percent, fixed_amount, applies_to, min/max_amount, active, notes
- **`shipping_rate_table`** (12+ rows): carrier, service_name, size_band, max_weight_kg, dimensions, cost/price_ex_vat/price_inc_vat, tracked, active
- **`selling_cost_defaults`** (8 rows): key-value pairs for packaging_cost, risk_reserve_rate, condition multipliers, min margin, min profit

## Design

Break Settings into dedicated sub-pages with sidebar entries, keeping it manageable:

### Option A: Separate pages (cleaner, matches the "Settings separate from operations" principle)

Add three new sidebar entries under a "Settings" group:
- **Settings** (existing — integrations + pricing engine params)
- **Selling Fees** → `/admin/selling-fees`
- **Shipping Rates** → `/admin/shipping-rates`

`selling_cost_defaults` fits naturally into the existing PricingSettingsCard (same key-value pattern as `pricing_settings`), so add it there.

### New pages

#### 1. Channel Fees Page (`/admin/selling-fees`)
- Table view grouped by channel (eBay, BrickLink, Web)
- Columns: Fee Name, Rate %, Fixed £, Applies To, Min/Max, Active, Notes
- Inline editing (click to edit, Enter to save — same pattern as PricingSettingsCard)
- Add new fee row button per channel
- Toggle active/inactive
- Delete with confirmation

#### 2. Shipping Rates Page (`/admin/shipping-rates`)
- Table view grouped by carrier (Evri, Royal Mail)
- Columns: Service, Size Band, Max Weight, Dimensions (L×W×D), Cost (ex-VAT), Price (inc-VAT), Tracked, Active
- Inline editing for cost/price fields
- Add new rate button
- Toggle active/inactive

#### 3. Selling Cost Defaults (added to existing PricingSettingsCard)
- Add `selling_cost_defaults` rows below `pricing_settings` rows in the same card
- Same inline edit pattern — they're both key-value tables

## Changes

### New files
| File | Purpose |
|------|---------|
| `src/hooks/admin/use-channel-fees.ts` | CRUD hooks for `channel_fee_schedule` |
| `src/hooks/admin/use-shipping-rates.ts` | CRUD hooks for `shipping_rate_table` |
| `src/hooks/admin/use-selling-cost-defaults.ts` | CRUD hooks for `selling_cost_defaults` |
| `src/pages/admin-v2/ChannelFeesPage.tsx` | Channel fees management page |
| `src/pages/admin-v2/ShippingRatesPage.tsx` | Shipping rates management page |

### Modified files
| File | Change |
|------|--------|
| `src/App.tsx` | Add routes for `/admin/selling-fees` and `/admin/shipping-rates` |
| `src/components/admin-v2/AdminV2Sidebar.tsx` | Add sidebar entries for Selling Fees and Shipping Rates under Settings group |
| `src/components/admin-v2/PricingSettingsCard.tsx` | Add `selling_cost_defaults` section below pricing_settings |

## Technical approach

- All hooks follow existing patterns: TanStack Query for reads, mutations for writes, `as never` casts for tables not yet in generated types
- Inline editing pattern matches PricingSettingsCard (click value to edit, Enter/Escape, Save/Cancel buttons)
- Channel fees grouped by channel with collapsible sections
- Shipping rates grouped by carrier
- "Add row" opens a form row at the bottom of each group
- Delete uses a confirmation dialog (shadcn AlertDialog)
- All mutations invalidate the relevant query key on success

