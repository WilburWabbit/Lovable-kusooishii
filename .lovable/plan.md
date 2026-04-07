
Goal

Fix the remaining duplicate-UID failure so purchases `881` and `1733` can process cleanly and the affected stock reconciliation can finally close.

What I verified

- Both purchases are still `error` in `landing_raw_qbo_purchase` with `stock_unit_uid_key` failures.
- Their `inbound_receipt` rows exist and are currently `pending`.
- There are no surviving `purchase_batches` or `stock_unit` rows for those purchases now.
- `purchase_batch_seq` has already advanced to `581`.
- So the current blocker is not stale leftover rows anymore; the collision is happening during the fresh stock-unit insert path itself.

Implementation plan

1. Make UID allocation deterministic in the database
- Add a migration that replaces the current per-row trigger counter mutation with a helper that reserves a UID range atomically for a batch.
- Keep the trigger only as a fallback for ad hoc/manual inserts, not as the primary bulk-import mechanism.

2. Update both purchase processors to use reserved UIDs
- `supabase/functions/qbo-process-pending/index.ts`
- `supabase/functions/process-receipt/index.ts`
- Before inserting stock units for a line, reserve the exact number of UIDs needed, attach those UIDs explicitly to the insert payload, and stop manually overwriting `purchase_batches.unit_counter` afterward.
- Add better diagnostics: QBO purchase id, batch id, receipt line id, and reserved UID range.

3. Keep reset/retry deterministic
- `supabase/functions/admin-data/index.ts`
- Keep the targeted reset path, but make its response report exactly what was cleared so retries are auditable.
- After deployment, reset `881` and `1733` again, then run Process Pending from a clean state.

4. Validate end-to-end
- `881` and `1733` move `error -> pending -> committed`
- New batch rows and stock units are recreated with sequential `PO...` UIDs
- `landed_cost`, SKU averages, and product/order display for `10349-1.1` repopulate correctly
- Stock reconciliation for the affected SKUs reaches parity

Files to change

- `supabase/migrations/...` new migration for deterministic UID reservation / trigger hardening
- `supabase/functions/qbo-process-pending/index.ts`
- `supabase/functions/process-receipt/index.ts`
- `supabase/functions/admin-data/index.ts`

Technical details

- Right now `purchase_batches.unit_counter` has mixed ownership: the DB trigger increments it per unit, while processors later overwrite it manually.
- The live database state shows no remaining batches/units for `881` or `1733`, which means cleanup is no longer the root issue.
- The durable fix is to make UID generation single-owner and deterministic during bulk purchase imports.
