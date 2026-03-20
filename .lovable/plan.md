

## Critical Review: QBO Stock Consistency Fixes

After reading every line of the four edge functions and admin-data, here is the complete bug list and proposed fix for each, organized by pathway.

### Confirmed Bugs

**Bug 1 — `qbo-sync-purchases`: `landPurchase()` never resets committed status (line 369-375)**
Updates `raw_payload` but always returns `alreadyLanded: existing.status === "committed"`. Even when the payload changes (e.g. 75418-1 SKU split), the fast-path at line 548 skips it. This is the root cause of the 75418-1 problem.

**Bug 2 — `qbo-sync-purchases`: Processed receipts only get backfill (line 637)**
`if (receipt.status === "processed")` runs `backfillProcessedReceipt` (tax codes + stock unit FK links) then marks as committed. It never deletes old lines or creates new ones. Changed purchase data (different SKUs, quantities, prices) is ignored.

**Bug 3 — `qbo-webhook` `handlePurchase`: Sold units just logged, not reallocated (line 528-531)**
When a purchase is updated via webhook, sold/closed stock units are logged with a warning but not reallocated to corrected SKUs. Available units are deleted correctly, but sold units retain stale SKU assignments.

**Bug 4 — `qbo-webhook` `handlePurchase`: Landed cost not updated on surviving sold units**
When purchase prices change, the webhook creates new stock units at the new landed cost but surviving sold units keep their old `landed_cost` and `carrying_value`.

**Bug 5 — `qbo-webhook` `handlePurchase` deletion: Blindly deletes sold stock units (line 476)**
`await admin.from("stock_unit").delete().in("inbound_receipt_line_id", lineIds)` deletes ALL stock units including sold/closed ones. Sold units represent historical transactions and should be written off, not deleted.

**Bug 6 — `reconcileQtyOnHand` (webhook line 1175 + sync-items line 157): QBO higher only logs, never backfills**
Both copies only log a warning and create an audit event when QBO has more stock than the app. Per user decision, this should auto-create balancing stock units.

**Bug 7 — `admin-data` `reconcile-stock` (line 1502-1526): Only reports, never auto-fixes**
The reconcile action pushes discrepancies to a `details` array with `action: "needs_review"` but takes no corrective action. Should auto-write-off (app > QBO) and auto-backfill (QBO > app).

**Bug 8 — No `rebuild-from-qbo` action exists**
There is no way to do a full deterministic replay from QBO snapshots.

### No Additional Bugs Found

After this final review, I confirm these 8 bugs are the complete set. The sales sync (`qbo-sync-sales`) was correctly fixed in the prior iteration — `landSalesReceipt` and `landRefundReceipt` already compare payloads and reset to pending (lines 177-189), and `processSalesReceipt` already does delete-and-recreate (lines 342-356). The stale SKU cleanup in `qbo-sync-items` is also already working (lines 434-501).

### Technical Changes

#### File 1: `supabase/functions/qbo-sync-purchases/index.ts`

**Change A — `landPurchase()` payload change detection (lines 369-375)**
Compare `raw_payload` JSON before and after. If changed and status is `committed`, reset to `pending`. Identical to the pattern already working in `landSalesReceipt()`.

**Change B — Processed receipt delete-and-recreate (lines 637-648)**
Replace `backfillProcessedReceipt` call with full reprocessing:
1. Query old receipt lines and their linked `stock_unit` rows
2. Delete available/received/graded stock units
3. For sold/closed stock units: attempt SKU reallocation by matching MPN to new lines; update `sku_id`, `landed_cost`, `carrying_value`; create audit events
4. Delete old receipt lines
5. Fall through to existing line-creation + auto-process code (line 677+)

#### File 2: `supabase/functions/qbo-webhook/index.ts`

**Change A — `handlePurchase` sold-unit SKU reallocation (lines 528-531)**
Replace the warning-only block with the same reallocation logic as the bulk sync: match sold units to new lines by MPN, update `sku_id` if changed, update `landed_cost` and `carrying_value`, create audit events.

**Change B — `handlePurchase` deletion: safe handling of sold units (lines 469-480)**
Instead of `admin.from("stock_unit").delete().in("inbound_receipt_line_id", lineIds)`:
- Write off available units (status → `written_off`, carrying_value → 0) with audit trail
- For sold/closed units: leave in place but nullify `inbound_receipt_line_id` FK and create audit event
- Then delete receipt lines and receipt as before

**Change C — `reconcileQtyOnHand` auto-backfill (lines 1175-1200)**
When `qboQty > appAvailable`, create balancing stock units with `landed_cost: 0`, `status: "available"`, tagged `source_system: 'qbo-adjustment'` in the audit event. Keep the existing audit trail.

#### File 3: `supabase/functions/qbo-sync-items/index.ts`

**Change A — `reconcileQtyOnHand` auto-backfill (line 157)**
Same change as webhook copy: auto-create balancing stock units when QBO > app. Both copies must stay in sync.

#### File 4: `supabase/functions/admin-data/index.ts`

**Change A — `reconcile-stock` auto-fix (lines 1502-1526)**
- App > QBO: write off excess available units (FIFO, oldest first) with audit trail
- QBO > app: auto-create balancing stock units tagged `source_system: 'qbo-reconcile'` with `landed_cost: 0`
- Return counts of `stock_written_off` and `stock_backfilled`

**Change B — New `rebuild-from-qbo` action**
1. Reset all `landing_raw_qbo_purchase` rows to `pending`
2. Reset all `landing_raw_qbo_sales_receipt` and `landing_raw_qbo_refund_receipt` rows to `pending`
3. For each QBO-sourced `inbound_receipt`: write off available stock units (audit trail), nullify sold units' `inbound_receipt_line_id` FK, delete receipt lines, reset status to `pending`
4. For each QBO-originated `sales_order`: reopen linked stock units, delete order lines, delete order
5. Return counts for UI feedback

#### File 5: `src/pages/admin/QboSettingsPanel.tsx`

**Change A — "Rebuild from QBO" button**
New button with confirmation dialog (destructive action). Calls `rebuild-from-qbo`, then auto-triggers Sync Purchases → Sync Sales → Reconcile Stock in sequence with progress display.

### Pathway Coverage Matrix

```text
Scenario                          Bulk Sync    Webhook    Rebuild
─────────────────────────────────────────────────────────────────
Purchase created                  Yes          Yes        Yes (replay)
Purchase updated (price)          Yes*         Yes*       Yes (replay)
Purchase updated (SKU split)      Yes*         Yes*       Yes (replay)
Purchase deleted                  N/A          Yes*       Yes (clean slate)
Sale created                      Yes          Yes        Yes (replay)
Sale updated                      Yes          Yes        Yes (replay)
Sale deleted                      N/A          Yes        Yes (clean slate)
QBO stock adjustment              Yes (items)  Yes (Item) Yes (reconcile)
Stale SKU cleanup                 Yes (items)  N/A        Yes (items runs)
QBO > app discrepancy             Backfill*    Backfill*  Backfill*
App > QBO discrepancy             Write-off*   Write-off* Write-off*
Sold unit SKU reallocation        Yes*         Yes*       Yes (replay)
Landed cost propagation           Yes*         Yes*       Yes (replay)

* = requires changes in this plan
```

### What This Does NOT Change

- Refunds still record negative lines without reopening stock
- eBay/web cross-channel dedup logic unchanged
- SKU pricing recalculation from changed landed costs is a downstream pricing engine concern
- No database migrations needed — all statuses and columns already exist

### Files Modified (5 total)

1. `supabase/functions/qbo-sync-purchases/index.ts`
2. `supabase/functions/qbo-webhook/index.ts`
3. `supabase/functions/qbo-sync-items/index.ts`
4. `supabase/functions/admin-data/index.ts`
5. `src/pages/admin/QboSettingsPanel.tsx`

