

# Fix Data Quality Issues: Ghost Units, Missing Set Numbers, Missing Product Names

## Issues Found

### 1. Ghost Stock Units (238 orphans, 118 for 10349-1)
Sales receipt processing creates "backfill" stock units when no purchase-linked unit exists. These have `batch_id = NULL`, `line_item_id = NULL`, `v2_status = NULL`, `landed_cost = 0`. Two purchases (QBO IDs 881, 1733) are stuck in `error` status due to UID duplicate key violations — the ghost units already claimed those UIDs.

**Fix**: Delete all 238 ghost stock units (they have no purchase provenance and corrupt cost averages). Then retry the 2 errored purchases. The sales processor will re-link to proper purchase-originated units.

### 2. `set_number` Missing on 364/368 Products
The `ensure_product_exists` database function never sets `set_number`. For LEGO products with MPN format `NNNNN-V`, the set number should be the numeric prefix (e.g., `75367-1` → `75367`).

**Fix**: 
- Update `ensure_product_exists` to derive `set_number` from MPN on insert
- Run a one-time backfill: `UPDATE product SET set_number = split_part(mpn, '-', 1) WHERE set_number IS NULL AND mpn ~ '^\d+-\d+$'`

### 3. Product Name Missing from Orders Pages
`useOrders` hook only selects `sku:sku_id(sku_code)` — no product name. The OrderList shows item count but no product context. The OrderDetail shows SKU codes but no human-readable names.

**Fix**:
- Update `use-orders.ts` to include `sku:sku_id(sku_code, name)` in the select
- Add `name` field to `OrderLineItem` type
- Update `OrderDetail.tsx` to show product name alongside SKU code
- Add a "Products" summary column to `OrderList.tsx` showing first product name

### 4. avg_cost Corrupted by Zero-Cost Ghost Units
With ghost units at `landed_cost = 0`, SKU `avg_cost` is dragged down. Removing ghost units fixes this, but `avg_cost` needs recalculation.

**Fix**: After ghost unit cleanup, trigger a recalculation of `avg_cost` on affected SKUs (count landed_cost from remaining real units).

## Changes

### Migration (1 SQL migration)
- Backfill `set_number` on all existing products from MPN
- Update `ensure_product_exists` function to derive `set_number` on insert

### Edge Function: `admin-data/index.ts`
- Add `cleanup-ghost-units` action: deletes stock units where `batch_id IS NULL AND line_item_id IS NULL`
- Add `recalc-avg-cost` action: recalculates `sku.avg_cost` from linked stock units

### Frontend
- `src/lib/types/admin.ts` — add `name` to `OrderLineItem`
- `src/hooks/admin/use-orders.ts` — include `name` in SKU select for both list and detail queries
- `src/components/admin-v2/OrderDetail.tsx` — show product name in line items table
- `src/components/admin-v2/OrderList.tsx` — add product name summary to items column
- `src/components/admin-v2/QboSettingsCard.tsx` — add "Cleanup Ghost Units" button in Process section

## Sequence
1. Deploy migration (backfill set_number + update function)
2. Deploy updated edge function with cleanup + recalc actions
3. Deploy frontend changes
4. Admin runs "Cleanup Ghost Units" → retries 2 errored purchases → runs "Recalc Avg Cost"

