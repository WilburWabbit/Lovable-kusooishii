

## Fix: eBay sync_listings MPN matching and sync_inventory linking

### Root Cause

The eBay inventory contains items with **three different SKU formats**:
- Bare MPN: `76273-1`, `72032-1`
- SKU with dot-grade suffix: `75418-1.1`, `col068.1`, `75230-1.1`
- SKU with old `-G` suffix: `31172-1-G1`, `75418-1-G1`

Both `sync_inventory` (line 391) and `sync_listings` (line 468-484) only do **exact** `skuMap.get(item.sku)` or `mpnToProduct.get(item.sku)` lookups. This means:

1. eBay SKU `76273-1` won't match local sku_code `76273-1.1` (no grade suffix on eBay side)
2. eBay SKU `75418-1.1` won't match MPN `75418-1` (grade suffix present on eBay side)
3. eBay SKU `31172-1-G1` won't match MPN `31172-1` or sku_code `31172-1.1` (old format)

Additionally, many matched SKUs have `product_id = null` (e.g. `sw0505`, `tgb005`, `col124`), so even when sync_inventory links the sku, sync_listings can't reach a product.

### Fix

**Add a shared `deriveMpn()` helper** that normalizes any eBay SKU format to an MPN:
- Strip `.N` grade suffix: `75418-1.1` → `75418-1`
- Strip `-GN` suffix: `31172-1-G1` → `31172-1`
- Leave bare MPNs unchanged: `76273-1` → `76273-1`

**In `sync_inventory`** (around line 391): After exact sku_code match fails, try:
1. `deriveMpn(item.sku)` → find matching SKU by prefix (sku_code starts with derived MPN)
2. Direct MPN → product lookup for enrichment

**In `sync_listings`** (around line 468-484): Improve strategy 2 to use `deriveMpn(item.sku)` instead of raw `item.sku` for the MPN lookup.

**Add logging** at each matching stage so future debugging is straightforward.

### Changes

| File | Change |
|------|--------|
| `supabase/functions/ebay-sync/index.ts` | Add `deriveMpn()` helper; update matching logic in `sync_inventory` and `sync_listings` to use fuzzy MPN derivation with fallbacks; add console.log for unmatched items |

