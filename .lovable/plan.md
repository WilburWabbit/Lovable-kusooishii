## Root cause

Unit `PO688-2` (SKU `31157-1.1`) was sold on 2 May at 08:47 (order `cf13fce5…`), but it still shows as in stock on the website.

Inspecting the unit in the database:

```
status:    'available'   ← legacy lifecycle column (unchanged)
v2_status: 'sold'        ← v2 lifecycle column (correctly set)
sold_at:   2026-05-02T08:47:33Z
order_id:  cf13fce5-…
```

The website's product page calls the `product_detail_offers(p_mpn)` RPC, which counts in-stock units with:

```sql
JOIN stock_unit su ON su.sku_id = s.id AND su.status = 'available'
```

So the offer counts any unit whose **legacy** `status` is `'available'`, even when its **v2** lifecycle has moved on to `'sold'`. Result: `stock_count = 1` for `31157-1.1` despite the unit being sold.

Why the legacy column wasn't updated: the `allocate_stock_for_order_line` RPC (called by `v2-process-order` during checkout) only writes to `v2_status`:

```sql
UPDATE public.stock_unit
SET v2_status = 'sold',
    sold_at   = COALESCE(sold_at, now()),
    order_id  = v_line.sales_order_id
WHERE id = v_unit.id;
```

It never advances the legacy `status` enum (which has no `'sold'` value — sold units should sit at `'allocated'` / `'picked'` / `'packed'` / `'shipped'` / `'delivered'` / `'closed'`). Every other read path that filters by `status = 'available'` will mis-report sold units as in stock — this isn't unique to the storefront.

## Fix

Make the offer query and the allocation RPC agree on a single source of truth for "is this unit still saleable", consistent with how `allocate_stock_for_order_line` itself selects units (it uses `COALESCE(v2_status, status) IN ('listed','graded','available','restocked')`).

### 1. Migration — patch `allocate_stock_for_order_line` to also advance legacy status

Update the unit-update statement in the RPC so future allocations move the legacy column to `'allocated'` (the correct post-sale, pre-pick lifecycle state) at the same time as setting `v2_status = 'sold'`:

```sql
UPDATE public.stock_unit
SET v2_status = 'sold',
    status    = 'allocated',
    sold_at   = COALESCE(sold_at, now()),
    order_id  = v_line.sales_order_id
WHERE id = v_unit.id;
```

This keeps the two columns aligned for every future sale through both the website and the eBay order processor (which calls the same RPC).

### 2. Migration — patch `product_detail_offers` to filter on the unified saleable predicate

Mirror the allocation RPC's predicate so the storefront stays correct even if a unit's legacy status drifts:

```sql
JOIN stock_unit su
  ON su.sku_id = s.id
 AND COALESCE(su.v2_status::text, su.status::text) IN ('listed','graded','available','restocked')
```

This makes "in stock on the website" mean exactly the same thing as "available to allocate to an order", which is the correct invariant.

### 3. Migration — backfill the one stuck unit

```sql
UPDATE public.stock_unit
SET status = 'allocated'
WHERE v2_status = 'sold'
  AND status   = 'available'
  AND order_id IS NOT NULL;
```

Scoped to units that have already been sold-and-linked to an order; safe to run as a one-off correction.

### 4. eBay quantity sync

`v2-process-order` already queues `pushEbayQuantityForSkus` after allocation, so eBay quantity will refresh via the existing outbox. No edge function changes needed — the RPC change alone fixes the website read path.

## Files

- `supabase/migrations/<new>_fix_sold_unit_status.sql` — three statements above (replace `allocate_stock_for_order_line`, replace `product_detail_offers`, backfill).

No frontend changes required. No edge function changes required.

## Verification

After deploy:
- `SELECT * FROM product_detail_offers('31157-1');` should return `stock_count = 0` for `31157-1.1`.
- Product page `/sets/31157-1` shows "No stock currently available" for grade 1.
- Future sales: confirm a freshly sold unit has `status = 'allocated'` and `v2_status = 'sold'`.
