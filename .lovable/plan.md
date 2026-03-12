

## Fix: Pricing Dashboard Incomplete Records

### Problem

50 of 84 `channel_listing` rows have `sku_id IS NULL`, so the pricing dashboard shows them with "—" for product name, MPN, SKU code, and grade. The query joins through `sku_id` to get product details, so unlinked rows appear incomplete.

The root cause is the previous SKU normalisation bug left these listings with `external_sku` values in old formats (`col068`, `31172-1-G1`, `76273-1`) that didn't match the `-G` format the system was using. Now that SKU codes are in QBO canonical format (`col068.1`, `31172-1.1`), all 50 orphaned listings can be matched.

### Fix

**1. Database migration** — backfill `sku_id` and update `external_sku` to canonical format:

```sql
-- Link orphaned channel_listing rows to their SKU
-- Match: external_sku directly, or with '.1' appended, or converting -G suffix to dot
UPDATE channel_listing cl
SET sku_id = s.id,
    external_sku = s.sku_code
FROM sku s
WHERE cl.sku_id IS NULL
  AND (
    s.sku_code = cl.external_sku
    OR s.sku_code = cl.external_sku || '.1'
    OR s.sku_code = regexp_replace(cl.external_sku, '-G(\d)$', '.\1')
  );
```

This links all 50 rows and updates their `external_sku` to the canonical QBO format so future syncs match directly.

**2. No frontend changes needed** — the pricing dashboard query is already correct. Once `sku_id` is populated, the existing join `sku:sku_id(sku_code, condition_grade, product:product_id(name, mpn))` will return complete data.

### Files changed

| File | Change |
|------|--------|
| New SQL migration | Backfill `sku_id` and normalize `external_sku` on orphaned listings |

