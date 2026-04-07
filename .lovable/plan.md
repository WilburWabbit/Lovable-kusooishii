

# Fix: Payouts, Orders, COGS, and Fee Linking

## Root Causes Found

### 1. Payout fees never link to orders (all 80 `payout_fee` rows have `sales_order_id = NULL`)
The `ebay-import-payouts` function queries `sales_order.external_order_id` to match eBay orders, but eBay order IDs are stored in `origin_reference`. The `external_order_id` column is always NULL, so `orderMap` is always empty and every fee is written with `sales_order_id = null`.

### 2. COGS is NULL on all 338 linked order lines
The QBO processor (`qbo-process-pending`) creates order lines with stock unit links but never writes `cogs`. The `v2-process-order` function does write COGS, but it skips already-allocated lines (`if (line.stock_unit_id) continue`). Since QBO processing links the units first, COGS is never populated.

### 3. `net_amount` is NULL on all 335 orders
No processor ever computes or writes `net_amount` to `sales_order`.

### 4. `unit_profit_view` shows all fees as zero
The view joins on `payout_fee.sales_order_id`, which is always NULL (consequence of issue #1).

## Fixes

### Fix 1: Correct order matching in `ebay-import-payouts`
**File: `supabase/functions/ebay-import-payouts/index.ts`**

Change the order lookup query from:
```sql
.select("id, external_order_id, qbo_sales_receipt_id, gross_total")
.in("external_order_id", orderRefs)
```
to:
```sql
.select("id, origin_reference, qbo_sales_receipt_id, gross_total")
.in("origin_reference", orderRefs)
```
Update the `LocalOrder` type and `orderMap.set()` key to use `origin_reference` instead of `external_order_id`.

### Fix 2: Populate COGS when QBO processor links stock units
**File: `supabase/functions/qbo-process-pending/index.ts`**

In the sales receipt processing section, wherever a `stock_unit_id` is written to `sales_order_line`, also write `cogs: landed_cost` from the consumed stock unit.

### Fix 3: Backfill COGS from linked stock units
**File: `supabase/functions/ebay-import-payouts/index.ts`** (or a migration)

Create a one-time migration to backfill existing data:
```sql
UPDATE sales_order_line sol
SET cogs = su.landed_cost
FROM stock_unit su
WHERE sol.stock_unit_id = su.id
  AND sol.cogs IS NULL;
```

### Fix 4: Populate `net_amount` on sales orders
**File: `supabase/functions/qbo-process-pending/index.ts`**

When creating/updating sales orders, compute `net_amount = gross_total - tax_total` and write it.

Also backfill via migration:
```sql
UPDATE sales_order
SET net_amount = gross_total - COALESCE(tax_total, 0)
WHERE net_amount IS NULL;
```

### Fix 5: Backfill `payout_fee.sales_order_id` for existing data
Migration to link existing payout fees to their orders:
```sql
UPDATE payout_fee pf
SET sales_order_id = so.id
FROM sales_order so
WHERE so.origin_reference = pf.external_order_id
  AND pf.sales_order_id IS NULL;
```

### Fix 6: Fix `v2-reconcile-payout` to also use `origin_reference`
**File: `supabase/functions/v2-reconcile-payout/index.ts`**

Verify and fix any queries that use `external_order_id` instead of `origin_reference` for matching.

## Files changed

| File | Change |
|------|--------|
| `supabase/functions/ebay-import-payouts/index.ts` | Fix order matching to use `origin_reference` |
| `supabase/functions/qbo-process-pending/index.ts` | Write `cogs` when linking stock units; write `net_amount` on order creation |
| `supabase/functions/v2-reconcile-payout/index.ts` | Fix order matching to use `origin_reference` |
| Migration | Backfill `cogs`, `net_amount`, and `payout_fee.sales_order_id` for existing data |

## Expected outcome
- Fee breakdown appears on order detail pages
- COGS displays for all allocated line items
- Net profit calculation works correctly
- Payout linked orders table shows correct fees per order
- `unit_profit_view` returns real fee and profit data

