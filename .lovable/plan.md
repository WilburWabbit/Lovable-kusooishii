

## Fix: eBay Listing Fails with "imageUrls can't be empty"

### Root Cause
Line 619: `imageUrls: prod?.img_url ? [prod.img_url] : []` — when the product has no `img_url`, an empty array is sent. eBay's Inventory API rejects this with error 25717.

The specific SKU that failed was `DG172-1.1`, whose product has no image URL set.

### Fix

**`supabase/functions/ebay-sync/index.ts`** — two changes:

1. **Also check `product_media` for images.** The product query already fetches `img_url` from the `product` table, but many products have images in `product_media` → `media_asset` instead. Query `product_media` joined to `media_asset` as a fallback when `prod.img_url` is null.

2. **Fail early with a clear error** if no images are found at all, rather than sending an empty array and getting a cryptic eBay API error.

```text
// Pseudocode for the image resolution:
let imageUrls: string[] = [];

// Primary: product.img_url
if (prod?.img_url) imageUrls.push(prod.img_url);

// Fallback: product_media table
if (imageUrls.length === 0 && prod?.id) {
  const { data: mediaRows } = await admin
    .from("product_media")
    .select("media_asset:media_asset_id(original_url)")
    .eq("product_id", prod.id)
    .order("sort_order")
    .limit(12);
  imageUrls = mediaRows
    ?.map(r => r.media_asset?.original_url)
    .filter(Boolean) || [];
}

// Fallback: lego_catalog img_url
if (imageUrls.length === 0 && prod?.mpn) {
  const { data: cat } = await admin
    .from("lego_catalog")
    .select("img_url")
    .eq("mpn", prod.mpn)
    .maybeSingle();
  if (cat?.img_url) imageUrls.push(cat.img_url);
}

if (imageUrls.length === 0) {
  throw new Error("Cannot publish: no images found for this product. Add at least one image first.");
}
```

3. **Use `imageUrls` array** in the inventory body instead of the current single-image logic. This also enables multi-image listings for products that have multiple media assets.

### Scope
| File | Change |
|------|--------|
| `supabase/functions/ebay-sync/index.ts` | Replace single `img_url` check with multi-source image resolution + early error |

No database migration needed.

