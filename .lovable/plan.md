

## Fix: Stock units not sold down by QBO sales sync

### Root Cause
All 673 stock units have status `received`. The FIFO stock matching in `qbo-sync-sales` queries for `status = 'available'`. No units match, so no stock is depleted.

### Solution
Two changes needed:

**1. Update `process-receipt` edge function** to set stock units to `available` instead of `received` when created during purchase sync processing.

Check `supabase/functions/process-receipt/index.ts` — find where `stock_unit` rows are inserted and change the status from `received` to `available`.

Also check `supabase/functions/qbo-sync-purchases/index.ts` for the same pattern — if it auto-processes and creates stock units directly, those also need `status: 'available'`.

**2. Bulk-update existing stock units** from `received` → `available` so the next sales sync run can match them.

Run: `UPDATE stock_unit SET status = 'available' WHERE status = 'received'`

**3. Re-run sales sync** — After updating existing stock, the user can re-sync sales. But since orders already exist (idempotent check), we also need to either:
- Delete the existing QBO sales orders so they re-import with stock matching, OR
- Add a "re-match stock" action that retroactively matches unlinked order lines to available stock

The simplest approach: delete existing QBO-imported sales orders and re-sync after fixing stock statuses.

### Files to edit
- `supabase/functions/process-receipt/index.ts` — change stock_unit insert status to `available`
- `supabase/functions/qbo-sync-purchases/index.ts` — same if applicable
- Data fix: bulk update `stock_unit` status, delete QBO sales orders for re-sync

### Technical detail
The `stock_unit_status` enum likely includes: `received`, `available`, `reserved`, `sold`, `closed`, `damaged`. The intent was that `received` → `available` happens after QA/inspection, but for auto-synced inventory this intermediate step isn't needed.

