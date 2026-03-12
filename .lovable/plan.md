

## Plan: Auto-Create Products During QBO Item Sync

### Problem
The `qbo-sync-items` function only **links** SKUs to existing `product` records by MPN lookup. It never creates new product records. So 94 SKUs have `product_id = NULL` — 20 of those have matching `lego_catalog` entries that could seed a product automatically.

### Fix
Update `qbo-sync-items/index.ts` to auto-create a `product` record when:
1. No product exists for the parsed MPN
2. A `lego_catalog` entry exists for that MPN

The new product is created from catalog data (name, theme_id, piece_count, release_year, retired_flag, img_url, subtheme_name) and then linked to the SKU.

### Changes

**`supabase/functions/qbo-sync-items/index.ts`**

After the `productByMpn` map is built (line ~116), also pre-fetch `lego_catalog` into a `catalogByMpn` map.

Inside the per-item loop, after MPN is parsed, if `productByMpn` has no match but `catalogByMpn` does:
1. Insert a new `product` row using catalog data
2. Add it to `productByMpn` so subsequent SKUs with the same MPN reuse it
3. Set `productId` on the SKU upsert

```text
Flow per QBO item:
  parse MPN from SKU
  productId = productByMpn[mpn]
  if (!productId && catalogByMpn[mpn]) {
    insert product from catalog
    productByMpn[mpn] = new product id
    productId = new id
  }
  upsert SKU with productId
```

For the 74 orphaned SKUs with no catalog match, the SKU is still created with `product_id = NULL` as before — those are minifigs/parts/non-standard items without catalog entries.

### Scope
| File | Change |
|------|--------|
| `supabase/functions/qbo-sync-items/index.ts` | Add catalog lookup + auto-create product logic |

No database migration needed. No frontend changes.

