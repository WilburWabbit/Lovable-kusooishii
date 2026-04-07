

# Fix: Duplicate Purchase Batches on QBO Reprocessing

## Problem

When QBO purchase 1733 is updated (via webhook), the landing record is reset to `pending` and reprocessed. Each reprocessing run creates a **new** `purchase_batches` row because the code does a blind `INSERT` without checking if a batch with the same `reference` (QBO purchase ID) already exists. This has produced three duplicate batches: PO-603, PO-665, PO-666 — all with `reference = '1733'`.

## Root cause

In `qbo-process-pending/index.ts`, the reprocessing cleanup (lines 487-510) correctly deletes old receipt lines and stock units, but:
1. It never checks for or deletes existing `purchase_batches` with the same `reference`
2. It never deletes linked `purchase_line_items`
3. The batch creation at line 630 is a blind `INSERT` with no upsert or existence check

## Fix

**File: `supabase/functions/qbo-process-pending/index.ts`**

Add cleanup of existing purchase batches during reprocessing. Before creating a new batch (around line 628), check for and delete any existing `purchase_batches` rows with `reference = qboPurchaseId`:

1. Query `purchase_batches` where `reference = qboPurchaseId`
2. For each found batch:
   - Delete linked `stock_unit` rows that are not sold (same pattern as receipt line cleanup)
   - Nullify links on sold stock units
   - Delete `purchase_line_items` for the batch
   - Delete the batch itself
3. Then proceed with the normal `INSERT`

This ensures that when a QBO purchase is updated and reprocessed, the old v2 model artifacts are cleaned up before new ones are created.

## Data cleanup

After deploying, delete the two orphan batches (PO-665 and PO-666) and their linked purchase_line_items and stock units. PO-603 is the original and should be kept if it has the correct data, or all three can be purged and purchase 1733 reset to `pending` for a clean reprocess.

## Files changed

| File | Change |
|------|--------|
| `supabase/functions/qbo-process-pending/index.ts` | Add batch cleanup before batch creation in `processPurchases` |

No migration needed — data cleanup will be done via the existing reset mechanism after the code fix is deployed.

