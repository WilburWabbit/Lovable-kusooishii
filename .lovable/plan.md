## QBO Sync Fix — Completed

### Changes Made

1. **Database**: Added `qbo_parent_item_id text` column to `sku` table + forced PostgREST schema cache reload
2. **qbo-sync-items**: Added PGRST204 fallback — retries upsert/update without `qbo_parent_item_id` if schema cache is stale
3. **qbo-webhook**: Same fallback pattern applied to all 3 SKU write locations (insert, update-link, upsert)
4. **qbo-sync-sales**: Refactored from "process entire month in one call" to chunked processing:
   - First call per month: lands from QBO + processes up to 25 pending receipts
   - Subsequent calls: skips landing, processes next 25 pending
   - Returns `has_more`, `remaining_pending`, `processed_count`
5. **QboSettingsPanel**: Inner loop per month — keeps invoking until `has_more=false` or user cancels

### Next Steps (User Action)
1. Run **Sync Items** — should now succeed without PGRST204 errors
2. Run **Sync Purchases** — ensures all stock units exist
3. Run **Sync Sales** — will process in chunks without 504 timeouts
4. Run **Reconcile Stock** — verify alignment with QBO
