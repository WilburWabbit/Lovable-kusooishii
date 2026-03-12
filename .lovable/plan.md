

## Pricing Dashboard

### What
A new `/admin/pricing` page showing all SKUs with their calculated floor, target, and ceiling prices alongside current listed prices per channel. Rows where listed price is below the floor are highlighted in red.

### Data Source
The `channel_listing` table already stores `price_floor`, `price_target`, `price_ceiling`, `confidence_score`, `priced_at`, and `listed_price`. Join with `sku` (for `sku_code`, `condition_grade`) and `product` (for `name`, `mpn`). No new tables or edge function changes needed -- this is a read-only view of existing data.

### Changes

**1. Create `src/pages/admin/PricingDashboardPage.tsx`**
- Query `channel_listing` joined with `sku` and `product` via Supabase client
- Standard admin table with columns: Product Name, MPN, SKU Code, Grade, Channel, Listed Price, Floor, Target, Ceiling, Confidence, Priced At
- Row highlight: red background tint when `listed_price < price_floor`
- Filters: channel dropdown, search by product name/MPN, "below floor only" toggle
- Use existing table infrastructure (`useTablePreferences`, `SortableTableHead`, `ColumnSelector`, `sortRows`)
- Summary stats cards at top: Total SKU-Channels priced, Below Floor count, Average Confidence

**2. Add route in `App.tsx`**
- `/admin/pricing` -> `PricingDashboardPage`

**3. Add sidebar entry in `BackOfficeSidebar.tsx`**
- Add "Pricing" under Operations, between Listings and Orders, using the `Calculator` icon

