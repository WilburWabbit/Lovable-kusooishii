

## Fix: Paginate Product Fetch + On-Demand Catalog Lookup in `qbo-sync-items`

### Root Cause
The `product` table pre-fetch (`admin.from("product").select("id, mpn")`) is also subject to the 1,000-row default limit. With ~260 products currently this isn't the bottleneck yet, but the real issue is that it will be as the catalog grows.

More importantly, the bulk `lego_catalog` fetch (26k+ rows) is wasteful — it's only needed for the rare case where a QBO item's MPN has no existing `product` record.

### Changes

**`supabase/functions/qbo-sync-items/index.ts`**

1. **Paginate the `product` pre-fetch** using a simple loop with `.range()` to ensure all products are loaded into `productByMpn`, not just the first 1,000.

2. **Remove the bulk `lego_catalog` pre-fetch entirely.** Replace lines 114 and 120-123 with an on-demand single-row lookup:
   - When `productId` is null for a given MPN (line 175), query `lego_catalog` for just that one MPN: `admin.from("lego_catalog").select("...").eq("mpn", mpn).eq("status", "active").maybeSingle()`
   - This replaces loading 26k rows with at most ~20 targeted queries (one per unmatched MPN)

3. **No other changes needed** — the auto-create logic (lines 177-199) stays the same, it just gets its catalog data from the per-MPN query instead of the map.

### Impact
- Eliminates the 26k-row catalog fetch entirely
- Ensures all products are found regardless of table size
- Each sync runs faster and uses far less memory

| File | Change |
|------|--------|
| `supabase/functions/qbo-sync-items/index.ts` | Paginate product fetch; replace bulk catalog with per-MPN lookup |

