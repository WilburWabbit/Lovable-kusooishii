

# Fix QBO Rebuild — Complete Data Integrity Overhaul

## Root Cause Summary

The rebuild ran but **79 of 86 purchases failed** with a single error: `cannot insert a non-DEFAULT value into column "carrying_value"`. This column is a **generated column** (`landed_cost - accumulated_impairment`), but the processor explicitly sets it on line 655. This means only 7 purchases succeeded, creating just 405 stock units (all orphaned from a prior rebuild). The 329 committed sales orders allocated against near-zero stock, explaining the massive discrepancies.

Additionally:
- **Processing order uses `received_at`** (random API landing order), not `TxnDate` (chronological). Purchases from 2024-12 are processed after 2025 purchases.
- **SHIPPING_ITEM_ID literal value** has no landing record, so the non-stock skip fails — it only checks `Service`/`NonInventory` types but gets `""` for missing items.
- **405 orphan stock units** with null `inbound_receipt_line_id` survived the rebuild.

## Changes

### 1. Fix `carrying_value` generated column error

**File**: `supabase/functions/qbo-process-pending/index.ts`

Remove `carrying_value: landedCost` from the stock unit insert payload (line 655). The column is `GENERATED ALWAYS AS (landed_cost - accumulated_impairment)` — Postgres computes it automatically. This single fix will unblock 79 failed purchases.

### 2. Process in chronological order (TxnDate)

**File**: `supabase/functions/qbo-process-pending/index.ts`

Change all landing table queries from `.order("received_at", { ascending: true })` to `.order("raw_payload->>'TxnDate'", { ascending: true })`. This ensures purchases are created oldest-first so sales can find available stock via FIFO allocation.

Affected functions: `processPurchases` (line 398), `processSalesReceipts` (line 760), `processRefundReceipts` (line 999), `processVendors` (line 1035), `processCustomers` (line 1147), `processItems` (line 254).

For items/vendors/customers that lack TxnDate in payload, keep `received_at` ordering (harmless for reference data).

### 3. Fix SHIPPING_ITEM_ID skip logic

**File**: `supabase/functions/qbo-process-pending/index.ts`

In `processSalesReceipts`, after the `landing_raw_qbo_item` lookup for each line, add a guard: if the `ItemRef.value` is not a numeric ID (like `SHIPPING_ITEM_ID`) OR the landing record doesn't exist, skip the line as non-stock. Currently it only checks `["Service", "NonInventory"]` but gets `""` for missing items.

```typescript
// Skip non-stock items: literal IDs, missing landing records, Service/NonInventory
if (!itemLanding || isNaN(Number(detail.ItemRef.value)) || 
    ["Service", "NonInventory"].includes(qboItemType)) {
  continue;
}
```

### 4. Rebuild must delete ALL customers

**File**: `supabase/functions/admin-data/index.ts`

The current rebuild only deletes customers without a `qbo_customer_id`. But customers whose QBO records were deleted still have stale `qbo_customer_id` values and show as `5evs46` with no name data. The rebuild should delete **all** customers (they're recreated from the customer landing table during replay).

Change Step 8 from:
```typescript
.is("qbo_customer_id", null)
```
to: delete ALL customers.

### 5. Rebuild must also delete `tax_code` and `vat_rate`

These are recreated from `landing_raw_qbo_tax_entity`. Add deletion of these tables in the rebuild sequence (after SKUs, before landing reset).

### 6. Clean up duplicate `allocate_stock_units` function

There are two versions of the function (one old, one new with v2_status support). Drop the old 2-arg version to prevent ambiguity.

## Files Modified

1. `supabase/functions/qbo-process-pending/index.ts` — remove `carrying_value`, chronological ordering, SHIPPING_ITEM_ID fix
2. `supabase/functions/admin-data/index.ts` — delete all customers, delete tax_code/vat_rate in rebuild
3. Database migration — drop old `allocate_stock_units` overload

## Expected Outcome

After deploying and running "Rebuild from QBO":
- All 623 purchases process successfully (no `carrying_value` error)
- Stock units created in chronological order, sales find correct stock via FIFO
- Channel detection, date override, and v2_status all work (already fixed in prior deploy)
- Customers fully rebuilt from QBO data with correct names
- No orphan stock, no duplicate receipts

