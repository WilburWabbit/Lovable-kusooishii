

## Fix: Missing VAT Rate on Inventory Items

### Root Cause

168 `inbound_receipt_line` records across 79 purchases have `tax_code_id = NULL` and `qbo_tax_code_ref = NULL`. These were created before the tax code extraction logic was added to the QBO purchases sync. The raw QBO payloads stored on `inbound_receipt.raw_payload` **do** contain the `TaxCodeRef` for every line — it was just never extracted.

Additionally, the existing `backfillProcessedReceipt` function has a bug: it matches lines by `(inbound_receipt_id, qbo_item_id)` with `.limit(1).single()`, but some receipts have multiple lines with the same item ID (e.g., the same set purchased at different unit prices). This means re-running the sync would only fix one of each duplicate, leaving the rest unfilled.

This affects 49 stock units that show no VAT rate or VAT amount on the Inventory page.

### Fix

Two changes needed:

**1. Database migration** — Backfill the 168 receipt lines directly using the `raw_payload` on each `inbound_receipt`. For each receipt with missing tax codes:
- Parse `raw_payload.Line[]` to extract `TaxCodeRef.value` per item line
- Match to `inbound_receipt_line` rows by `qbo_item_id` and `unit_cost` (to disambiguate duplicate items)
- Set `qbo_tax_code_ref` and resolve `tax_code_id` via the `tax_code` table

This will be done as a one-time SQL migration using a PL/pgSQL block.

**2. `supabase/functions/qbo-sync-purchases/index.ts`** — Fix the `backfillProcessedReceipt` function so that future syncs don't re-introduce this gap:
- Change the line lookup from `.eq("qbo_item_id", qboItemId).limit(1).single()` to a query that also matches on `unit_cost` (from the raw line's `UnitPrice`) to disambiguate duplicate item lines
- Fall back to updating all unresolved lines with the same `qbo_item_id` if unit cost matching isn't possible

### Files changed

| File | Change |
|------|--------|
| Database migration | PL/pgSQL block to backfill 168 receipt lines with tax codes from raw payloads |
| `supabase/functions/qbo-sync-purchases/index.ts` | Fix duplicate-item-id matching in `backfillProcessedReceipt` (~5 lines) |

