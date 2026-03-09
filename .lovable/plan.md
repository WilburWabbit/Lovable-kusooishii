

## Plan: Fix Import to Populate Subtheme and Image Data

### Problem
All 24,743 products have `NULL` for both `img_url` and `subtheme_name`. The edge function code correctly maps these fields, but the data was likely imported before the updated function was deployed. The batch errors at rows 1000, 14000, and 22000 are from duplicate MPNs within the same batch during the product upsert (not themes).

### Fix

**1. Update `supabase/functions/import-sets/index.ts`:**
- Deduplicate products by MPN (keep last occurrence) before batching, to eliminate within-batch duplicate key errors
- No other code changes needed — the `cols[3]` → `img_url` and `cols[5]` → `subtheme_name` mapping is already correct

**2. Upload the new CSV and re-invoke:**
- Upload `sets-2.csv` to storage at `media/imports/sets.csv`
- Invoke the edge function to re-import, which will upsert all products with the correct img_url and subtheme_name values

### Files Changed
- `supabase/functions/import-sets/index.ts` — add deduplication step before batching

