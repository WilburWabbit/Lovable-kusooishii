

## Problem Analysis

Items like `sw0574` are minifigures whose SKUs have `product_id = null` because no matching `product` record exists. This causes three symptoms:

1. **Not in Products page** — the `list-products` action groups SKUs by `product_id` and skips any with `null` (line 224 of admin-data).
2. **Visible in Inventory & Listings** — those views query SKUs directly regardless of `product_id`.
3. **Can't click to open from Listings** — the row click handler is `r.product_id && navigate(...)`, so null product_id rows are inert.

## Plan

### 1. Auto-create product records for orphan SKUs

In `supabase/functions/admin-data/index.ts`, within the `list-listings` action (or as a separate preparatory step), detect SKUs where `product_id IS NULL` and auto-create a `product` record using the SKU's MPN and name. This mirrors what the QBO item sync already does for catalog items, but covers non-catalog items (minifigures etc.) that slipped through.

Alternatively, this can be a one-off migration + a fix in the QBO sync to always create a product record.

### 2. Make Listings rows always clickable

In `src/pages/admin/ListingsPage.tsx`, for SKUs without a `product_id`, navigate to a product detail page by SKU id or create a fallback detail view. The simplest approach: auto-create the product (option 1) so there's always a `product_id` to navigate to.

### Recommended approach: Database migration + edge function fix

**Step A — Migration**: Create `product` records for all orphan SKUs:

```sql
INSERT INTO product (mpn, name, product_type, status)
SELECT DISTINCT su.mpn, s.name, 'minifigure', 'active'
FROM sku s
JOIN stock_unit su ON su.sku_id = s.id
WHERE s.product_id IS NULL
  AND su.mpn IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM product p WHERE p.mpn = su.mpn)
ON CONFLICT DO NOTHING;

-- Then link orphan SKUs to the newly created products
UPDATE sku SET product_id = p.id
FROM product p
WHERE sku.product_id IS NULL
  AND sku.sku_code LIKE p.mpn || '.%'
  OR sku.sku_code = p.mpn;
```

**Step B — Edge function**: In the QBO item sync (`qbo-sync-items`), ensure that when a new SKU is created for a non-catalog MPN, a `product` record is also created (same as it does for catalog items). This prevents future orphans.

**Step C — UI fallback** (safety net): In `ListingsPage.tsx`, if `product_id` is still null, show the row as clickable but navigate to a search or show a toast explaining the item needs to be linked.

### Files to change
- `supabase/migrations/` — new migration to backfill product records for orphan SKUs
- `supabase/functions/qbo-sync-items/index.ts` — ensure product creation for non-catalog items
- `src/pages/admin/ListingsPage.tsx` — minor: make rows without product_id still provide feedback on click

