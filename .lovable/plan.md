

## Backfill VAT Codes on Inventory

### Problem
- Receipt lines have `qbo_tax_code_ref = NULL` and `tax_code_id = NULL` for all 468 lines
- Stock units have `inbound_receipt_line_id = NULL` for all 673 units
- The raw QBO payload stored on each receipt **does** contain the TaxCodeRef per line — it just wasn't captured

### Root Cause
Existing processed receipts were synced before the tax_code resolution code was added. The current sync skips processed receipts entirely (line 329), so re-syncing won't fix them.

### Solution: Update `qbo-sync-purchases` to backfill on re-sync

Modify the sync so that for **processed** receipts, it still:
1. Extracts `TaxCodeRef` from each raw_payload line and updates `inbound_receipt_line.qbo_tax_code_ref` and `tax_code_id`
2. Backfills `stock_unit.inbound_receipt_line_id` by matching stock units to receipt lines via `mpn + condition_grade` within each receipt

Then the user simply re-runs "Sync Purchases" from the admin UI.

### Changes

#### 1. `qbo-sync-purchases/index.ts`

**For processed receipts** (currently skipped at line 329–332), add a backfill block:
- Parse `raw_payload.Line` to extract `TaxCodeRef.value` per item line
- Match to existing `inbound_receipt_line` rows by `qbo_item_id`
- Resolve `qbo_tax_code_ref` → `tax_code.id` and update `tax_code_id`
- Query `stock_unit` rows that have `inbound_receipt_line_id IS NULL`, match to receipt lines by `mpn + condition_grade`, and update the link (respecting line quantity)

**For new receipts** — fix `autoProcessReceipt`:
- When inserting stock units, include the `inbound_receipt_line_id` from the line being processed
- This requires passing line IDs into autoProcessReceipt (insert lines first, get IDs back, then process)

#### 2. `process-receipt/index.ts`
- Already sets `inbound_receipt_line_id` — verify it's correct (it is from the previous change)

### Files to modify
- `supabase/functions/qbo-sync-purchases/index.ts` — backfill logic + forward-fix for autoProcessReceipt

### After deployment
User re-runs "Sync Purchases" from admin settings. All receipt lines get tax_code_id populated, all stock units get linked to their receipt lines, and VAT columns across Intake/Inventory/Orders will display correctly.

