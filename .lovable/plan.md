## QBO Sync — Stock Consistency Fixes

### Changes Made

1. **Sales sync re-landing (Bug 1)**: `landSalesReceipt` and `landRefundReceipt` now compare `raw_payload` JSON — if changed, reset status from `committed` → `pending` so Phase 2 reprocesses it.

2. **Sales sync delete-and-recreate (Bug 2)**: `processSalesReceipt` and `processRefundReceipt` now delete-and-recreate existing QBO-originated orders (reopening linked stock units first) instead of skipping them. Cross-channel dedup (eBay/web) still enriches only.

3. **Purchase webhook reprocessing (Bug 3)**: `handlePurchase` in `qbo-webhook` no longer skips already-processed receipts. It cleans up old stock units (deletes available ones, warns about closed/sold ones), resets receipt to pending, and re-runs the auto-process flow.

4. **Stale SKU cleanup (Bug 4)**: `qbo-sync-items` now runs a cleanup pass after the main loop — any SKU with a `qbo_item_id` not seen in the current sync gets `active_flag = false`, and its available stock units are written off with full audit trail.

### What Was NOT Changed
- Refunds do NOT reopen stock (per user requirement)
- QtyOnHand reconciliation remains as safety net
- No database migrations needed
- No UI changes needed

### Next Steps
1. Run **Sync Items** — will now deactivate stale SKUs
2. Run **Sync Purchases** — will now reprocess updated purchases
3. Run **Sync Sales** — will now reprocess updated/stale receipts
4. Verify stock alignment with QBO
