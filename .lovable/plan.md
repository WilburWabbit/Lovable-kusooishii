## Plan: Use QBO SKU Verb

&nbsp;

## Plan: Use QBO SKU Verbatim as Canonical SKU Code

### Problem

The app invented a `-G{grade}` SKU format (e.g. `1031-1-G1`) that doesn't exist anywhere outside this system. QBO uses `1031-1.1` (or just `1031-1`). eBay should use the same. The app currently converts between formats in multiple places, causing mismatches and unnecessary complexity.

### Principle

The QBO SKU field is the canonical identifier. It is stored and used verbatim everywhere. The dot is only interpreted to extract MPN and condition grade for internal use (product linking, grading). No format conversion ever occurs.

### Changes Required

**7 edge functions** need updating. Every instance of `${mpn}-G${grade}` SKU construction must be replaced with the original QBO SKU value used verbatim.


| File                                             | What changes                                                                                                                                                                                                        |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `supabase/functions/qbo-sync-items/index.ts`     | Stop constructing `${mpn}-G${conditionGrade}`. Use the raw QBO `Sku` field (or `Name` fallback) as `sku_code` directly. Still call `parseSku()` to extract MPN and grade for `condition_grade` and product linking. |
| `supabase/functions/qbo-webhook/index.ts`        | `resolveSkuFromQboItem`: use QBO Sku field verbatim as `skuCode` instead of `${p.mpn}-G${p.conditionGrade}`. Same for `handlePurchase` and `handleItem` SKU construction.                                           |
| `supabase/functions/qbo-sync-sales/index.ts`     | All 3 places that build `${parsed.mpn}-G${parsed.conditionGrade}` — use the raw QBO Sku field instead.                                                                                                              |
| `supabase/functions/qbo-sync-purchases/index.ts` | Replace `${mpn}-G${conditionGrade}` with the original SKU from the receipt line.                                                                                                                                    |
| `supabase/functions/process-receipt/index.ts`    | Replace `${mpn}-G${conditionGrade}` with the original QBO SKU stored on the receipt line (need to ensure the raw SKU is available on the line).                                                                     |
| `supabase/functions/ebay-sync/index.ts`          | Delete `normaliseSkuCode()`. Use `item.sku.trim().toLowerCase()` for direct lookup against `sku_code`. Remove the `-G` conversion path.                                                                             |
| `supabase/functions/ebay-process-order/index.ts` | Delete `normaliseSkuCode()`. Direct SKU lookup. Remove the `.replace("-G", ".")` reverse conversion on line 653 — since `sku_code` will already be in QBO format, use it directly for QBO item lookup.              |


### Database Migration

Existing `sku_code` values in the `sku` table need converting from `-G` format back to QBO dot format:

```sql
-- Convert existing SKU codes from invented -G format to QBO canonical format
-- e.g. '10311-G1' → '10311.1', '10311-G3' → '1031-1.3'
-- SKUs without -G suffix (if any) are left unchanged
UPDATE sku
SET sku_code = regexp_replace(sku_code, '-G(\d)$', '.\1')
WHERE sku_code ~ '-G\d$';
```

A second pass to handle the "grade 1 without dot" convention is **not** done — QBO may store these as `1031-1` or `1031-1.1`, and the app should match whichever QBO actually uses. The migration converts what exists; future syncs will use the QBO value verbatim.

### Receipt Line Schema

The `inbound_receipt_line` table stores `mpn` and `condition_grade` but not the original raw SKU string. The `process-receipt` function needs the original SKU to use as `sku_code`. 

### Changes Required

Add a `sku_code` column to `inbound_receipt_line` and populate it with the raw QBO sku value.

### What `parseSku()` becomes

`parseSku()` remains unchanged — it still splits on `.` to extract MPN and grade. But its output is used **only** for setting `condition_grade` and `product_id` lookup by MPN. It is never used to construct a new SKU code.