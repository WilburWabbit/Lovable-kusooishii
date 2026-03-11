

## Fix: Missing VAT on eBay Order Lines

### Root Cause

10 order lines (all eBay-origin) have no `tax_code_id` set. These are eBay orders that were never matched to a QBO Sales Receipt, so they never got tax data backfilled. The `ebay-process-order` function inserts `sales_order_line` records without a `tax_code_id` (lines 782-788), so any eBay order not subsequently enriched by QBO sync shows "—" for VAT.

The remaining 84 lines (74 eBay + 10 QBO refund) all have the correct `20.0% S` tax code and display correctly.

### Fix

| Change | Detail |
|--------|--------|
| **Database migration** | Backfill the 10 existing eBay order lines with `tax_code_id` = "20.0% S" (`7a295077-...`). Also set `qbo_tax_code_ref = '6'` for consistency. |
| **`supabase/functions/ebay-process-order/index.ts`** | When inserting `sales_order_line` (line 782), look up the "20.0% S" tax code and set `tax_code_id` and `qbo_tax_code_ref` on each line. This ensures all future eBay orders show VAT correctly without requiring QBO enrichment. |

### Files changed

| File | Change |
|------|--------|
| `supabase/functions/ebay-process-order/index.ts` | Add tax code lookup + set `tax_code_id` on line insert (~8 lines) |
| Database migration | Backfill 10 lines with missing tax_code_id |

