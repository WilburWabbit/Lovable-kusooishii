

# Fix QBO Sync — Complete Root Cause Analysis and Remediation Plan

## Issues Found (from database analysis)

### Issue 1: ALL 97 QBO Deposits Failed — Missing `currency` Column
**Root cause**: `processDeposits()` in `qbo-process-pending` inserts `currency` into the `payouts` table, but that column does not exist. The `payouts` table has no `currency` column — every single deposit failed with: *"Could not find the 'currency' column of 'payouts' in the schema cache"*.
**Impact**: Zero payouts created. No payout reconciliation possible. All order statuses remain stuck (never reach `payout_received`/`complete`).
**Fix**: Remove `currency` from the deposit insert payload in `processDeposits()`. The `payouts` table tracks currency at the transaction level, not the payout level.

### Issue 2: 217 Orphan Stock Units — Backfilled Without Batch or Receipt
**Root cause**: The "Reconcile Stock" function (`admin-data` reconcile-stock action) creates backfill stock units with `v2_status=null`, `batch_id=null`, `inbound_receipt_line_id=null` when QBO reports higher quantities than the app. These 217 units (including 96x 10349-1.1, 7x Hue-GU10-WC.2, 5x GJ2CQ, etc.) were created by reconciliation — they are the exact discrepancies shown in the screenshot.
**Impact**: These ghost units inflate stock counts. They appear in the Stock Discrepancies panel because QBO still reports them as on-hand but they have no purchase provenance.
**Fix**: During rebuild Phase 2, the deletion step must also delete stock units where `batch_id IS NULL` (orphan backfills). Currently only deletes all stock, but the screenshot proves some survive — likely because the rebuild ran, then reconcile-stock was run afterwards, re-creating them. Add a post-rebuild guard: do NOT run reconcile-stock automatically after a rebuild. The rebuild itself should produce correct stock levels.

### Issue 3: 2 Purchases Failed — Duplicate UID Constraint
**Root cause**: `stock_unit.uid` has a unique constraint. During rebuild, if the UID generation produces a collision (e.g. from a trigger or default), the insert fails. The 2 failing purchases show: *"duplicate key value violates unique constraint 'stock_unit_uid_key'"*.
**Impact**: 2 purchases not fully processed; their stock units are missing.
**Fix**: In `processPurchases`, do not set `uid` explicitly — let the database trigger or default handle it. If the trigger generates UIDs from batch ID + sequence, ensure it handles rebuild correctly (no stale sequence state). Alternatively, omit the `uid` field from the insert payload entirely.

### Issue 4: Zero Web/Stripe Orders After Rebuild
**Root cause**: The rebuild correctly resets `landing_raw_stripe_event` to `pending` (Step 6 in admin-data), but Phase 3 in `QboSettingsCard` never replays Stripe events. It only drains QBO entity types. There is no "Phase 4" to replay Stripe/eBay landing events.
**Impact**: All website orders disappear after rebuild. Only eBay orders (which come through QBO SalesReceipts) are recreated.
**Fix**: Add Phase 4 to `QboSettingsCard` rebuild flow: after QBO processing completes, invoke the Stripe webhook processor and eBay order processor to replay their pending landing events. This is referenced in the approved plan but was never implemented.

### Issue 5: Channel Attribution — No `web` Orders From QBO
**Root cause**: QBO SalesReceipts for Stripe/website orders have DocNumber starting with `KO-`. The `detectOriginChannel` function correctly returns `"web"` for these. However, the query `select origin_channel, count(*) from sales_order group by origin_channel` shows 0 web orders. This means either (a) no QBO SalesReceipts have `KO-` DocNumbers, or (b) the match-first logic on lines 862-900 is matching them to existing orders and enriching rather than creating — but since Stripe orders were deleted in the rebuild and never replayed, there's nothing to match against.
**Impact**: Website sales are completely missing from the app.
**Fix**: Same as Issue 4 — replay Stripe landing events. The QBO SalesReceipts with `KO-` prefixes should then match against the recreated Stripe orders.

### Issue 6: Customer Count May Include Stale Records
**Current state**: 318 customers in app, 318 in landing table. The orphan cleanup appears to be working (no orphans found). However, the user reports seeing QBO-deleted customers. Since the customer sync now filters `Active = true`, this should be resolved. If any persist, they may be from pre-rebuild data that wasn't cleaned.
**Fix**: No code change needed — verify after next rebuild. The existing orphan cleanup logic should handle this.

---

## Implementation Plan

### Step 1: Fix `processDeposits` — Remove `currency` field
**File**: `supabase/functions/qbo-process-pending/index.ts`
In the `processDeposits` function (~line 1336), remove `currency` from the payout insert and update payloads. The `payouts` table does not have a `currency` column.

### Step 2: Fix stock unit UID collision during rebuild
**File**: `supabase/functions/qbo-process-pending/index.ts`
In `processPurchases` (~line 700), ensure the stock unit insert payload does NOT include a `uid` field — let the database trigger generate it. Check if any explicit `uid` is being set.

### Step 3: Delete orphan stock units during rebuild
**File**: `supabase/functions/admin-data/index.ts`
After the main stock deletion (Step 3, ~line 1696), add an explicit deletion for any remaining stock units with `batch_id IS NULL`. This catches backfill units from prior reconciliation runs.

### Step 4: Add Stripe/eBay replay phase to rebuild
**File**: `src/components/admin-v2/QboSettingsCard.tsx`
After Phase 3g (deposit processing), add:
- Phase 4a: Replay Stripe landing events (call `stripe-webhook` processor or equivalent)
- Phase 4b: Replay eBay order landing events (call `ebay-process-order` or equivalent)
- Phase 4c: Replay eBay payout landing events (call `ebay-import-payouts` or equivalent)
- Phase 4d: Run payout reconciliation for all created payouts

### Step 5: Reset all errored deposits for reprocessing
After deploying the fixed `processDeposits`, reset all 97 errored deposit landing records back to `pending` so they can be reprocessed on the next rebuild or manual "Process Pending" action. This is a data operation (UPDATE), not a schema change.

### Step 6: Verify purchase error recovery
After deploying the UID fix, reset the 2 errored purchase landing records back to `pending` for reprocessing.

---

## Files Modified

1. `supabase/functions/qbo-process-pending/index.ts` — remove `currency` from deposit processing; verify no explicit `uid` in stock unit inserts
2. `supabase/functions/admin-data/index.ts` — add orphan stock cleanup (`batch_id IS NULL`) to rebuild
3. `src/components/admin-v2/QboSettingsCard.tsx` — add Phase 4 (Stripe/eBay replay) to rebuild flow

## Expected Outcome

After deploying and running "Rebuild from QBO":
- All 97 QBO deposits process successfully into `payouts` table
- No orphan stock units remain (backfill ghosts eliminated)
- 2 previously failing purchases process correctly
- Stripe/website orders are restored via landing event replay
- Payout reconciliation runs against the complete order set
- Stock discrepancy panel shows zero differences

