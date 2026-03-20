

## Fix: Rebuild-from-QBO Duplication Bug

### Root Cause

The `rebuild-from-qbo` action has a **step ordering bug** that creates ghost stock units:

1. **Step 2** writes off all available stock units and orphans sold ones (nullifies receipt-line FK)
2. **Step 3** then loops through QBO sales orders and **reopens** their linked stock units back to `status: "available"` — overwriting the write-off from step 2
3. Step 3 then deletes the sales orders

After this, the sync runs and creates brand new stock units from receipt lines. The reopened ghost units from step 3 remain as orphaned "available" units with no `inbound_receipt_line_id`.

**Current state**: 366 orphaned available stock units with `inbound_receipt_line_id = NULL` (e.g. 110 for 10349-1 alone, which should only have 144 total from its receipt).

### Fix

**File: `supabase/functions/admin-data/index.ts` — `rebuild-from-qbo` action**

Reverse the order: delete sales orders FIRST (step 3), THEN clean up stock (step 2). And critically, the sales order cleanup should NOT reopen stock — it should just delete the order lines and orders. The subsequent stock cleanup will handle the units.

Revised logic:
1. Reset all landing tables to `pending` (unchanged)
2. **Delete QBO sales orders first** — delete order lines and orders, but do NOT reopen stock units (remove the `status: "available"` update entirely)
3. **Then clean up stock** — for ALL stock units linked to receipt lines: delete available/received/graded units outright (not write-off), and nullify FKs on closed units
4. Delete receipt lines and reset receipts to `pending`

The key changes:
- Remove `await admin.from("stock_unit").update({ status: "available" }).eq("id", ol.stock_unit_id)` from step 3 — this is what causes ghost units
- Change stock cleanup from write-off to **hard delete** for non-closed units — write-offs leave phantom records that bloat the database
- Delete orphaned available units (no receipt line link) as part of cleanup

**File: `supabase/functions/admin-data/index.ts` — add data cleanup for current state**

Add a new `cleanup-orphaned-stock` action that deletes all stock units where `status = 'available'` and `inbound_receipt_line_id IS NULL`. This fixes the current 366 orphaned units from the failed rebuild.

### Files Modified

- `supabase/functions/admin-data/index.ts` — fix rebuild step ordering, remove stock reopening, add orphan cleanup action

