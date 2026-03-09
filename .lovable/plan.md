

## Decouple SKU/Stock from Catalog — Auto-Process All QBO Items

### Problem
The sync treats `catalog_product` as the gatekeeper: if an item's MPN isn't in the LEGO catalog, the receipt stays pending forever. But `catalog_product` is a reference table for LEGO sets (wishlists), not the authority for stocked items. QBO is authoritative — minifigs, parts, books, gear, and non-LEGO items should all flow through.

### Approach
Make SKUs independent of the catalog. A SKU can optionally link to a catalog product (for LEGO sets), but can also stand alone using QBO item data. Every QBO item-based line processes automatically — no more "not found in catalog" exceptions.

### Changes

**1. Database migration** — Two changes to the `sku` table:
- Make `catalog_product_id` nullable (currently NOT NULL)
- Add a `name` text column (for display when no catalog product is linked)
- Add a unique constraint on `(sku_code)` to allow SKU lookup without catalog_product_id

**2. `supabase/functions/qbo-sync-purchases/index.ts`** — Rewrite `autoProcessReceipt` logic:
- When MPN matches a catalog product → existing behavior (link SKU to catalog product)
- When MPN does NOT match → create SKU directly using QBO item name as `name`, MPN as `sku_code` base, no `catalog_product_id`
- Find-or-create SKU by `sku_code` instead of `catalog_product_id + condition_grade`
- Remove the "not found in catalog → skip" logic entirely — all stock lines process

**3. `supabase/functions/process-receipt/index.ts`** — Same changes as above for manual processing path. Also remove `carrying_value` from insert (same bug as previously fixed in sync).

**4. `supabase/functions/admin-data/index.ts`** — Update the stock-unit query to handle nullable `catalog_product`:
```
sku:sku_id(sku_code, name, catalog_product:catalog_product_id(name))
```

**5. `src/pages/admin/InventoryPage.tsx`** — Display `sku.name` as fallback when `sku.catalog_product` is null. Update the `StockRow` type and search filter accordingly.

### What stays the same
- Storefront browse (`browse_catalog` function) uses INNER JOINs to catalog_product, so non-catalog SKUs naturally won't appear on the shop — correct behavior.
- Wishlists continue referencing catalog_product as before.
- Overhead apportionment logic unchanged.

### Data flow after change
```text
QBO Purchase Line
  ├─ MPN found in catalog_product
  │   → SKU linked to catalog_product (sku_code = "MPN-G1")
  │   → stock_unit created
  │
  └─ MPN NOT in catalog_product
      → SKU created standalone (name from QBO, sku_code = "MPN-G1")
      → stock_unit created
      → Receipt marked processed ✓
```

