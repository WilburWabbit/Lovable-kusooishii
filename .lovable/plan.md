

## Backfill VAT Codes on Sales Order Lines

### Problem
All 373 existing `sales_order_line` rows have `tax_code_id = NULL` and `qbo_tax_code_ref = NULL`. The forward-fix code in `qbo-sync-sales` already resolves these for **new** orders, but the existing orders were synced before that logic was added.

### Solution
Add a backfill step to `qbo-sync-sales` that runs on every sync — for all existing QBO-origin orders that have lines missing `tax_code_id`:

1. Re-fetch the QBO SalesReceipt/RefundReceipt by ID (using `origin_reference`)
2. For each item line, extract `TaxCodeRef.value`
3. Resolve to `tax_code.id` via `qbo_tax_code_id` match
4. Update `sales_order_line.tax_code_id` and `qbo_tax_code_ref`

### Changes

**`supabase/functions/qbo-sync-sales/index.ts`**

Add a `backfillSalesVat` function after the main sync loop:
- Query all `sales_order` rows where `origin_channel IN ('qbo', 'qbo_refund')` that have at least one line with `tax_code_id IS NULL`
- For each order, fetch the QBO transaction by ID (`SalesReceipt/{origin_reference}` or `RefundReceipt/{origin_reference}`)
- Match item lines to `sales_order_line` rows by `sku_id` (resolve QBO Item → SKU code → sku.id)
- Set `qbo_tax_code_ref` and `tax_code_id` on each matched line
- Return backfill counts to include in the sync response

**`src/pages/admin/QboSettingsPanel.tsx`**
- Display backfilled line count in the sync toast

### Scope
- 1 edge function modified, 1 UI file updated
- User re-runs "Sync Sales" to trigger the backfill
- After backfill, VAT % column on Orders page will show correct values

