

# Fix: Ghost Units and Stuck Purchases — Root Cause and Resolution

## What went wrong

Three compounding issues:

1. **The `admin-data` edge function was not redeployed** after the cleanup code was added. The button clicks in the UI likely ran the OLD version of the function (which didn't have the cleanup logic), or returned errors silently. The edge function logs show zero recent calls to `admin-data`.

2. **`reconcile-stock` is the SOURCE of ghost units.** Lines 1548-1567 auto-backfill stock units when QBO qty exceeds app qty. These backfill units have `batch_id = NULL`, `line_item_id = NULL`, `v2_status = NULL`, and `landed_cost = 0` — exactly the 213 ghosts currently in the database. Every time you run "Reconcile Stock" while purchases 881 and 1733 are stuck, it re-creates the ghosts you just cleaned up.

3. **Purchases 881 and 1733 remain in `error` status** with "duplicate key" messages. The cleanup was supposed to reset them to `pending`, but since the deployed function was stale, nothing happened.

## Fix — three changes in one deployment

### 1. Stop `reconcile-stock` from creating ghost units

The backfill logic at line 1548-1567 creates units with no purchase provenance, violating the "app-controlled truth" principle. Replace auto-backfill with **report-only** — flag the discrepancy but do not insert fake units.

**File**: `supabase/functions/admin-data/index.ts`, lines 1548-1586

Replace the backfill block with:
```typescript
// QBO has more than app — report only (do NOT auto-create ghost units)
const shortfall = qboQty - available;
qboHigher++;
details.push({
  sku_code: sku.sku_code,
  qbo_qty: qboQty,
  app_qty: available,
  diff: shortfall,
  direction: "qbo_higher",
  action: "report_only",
});
```

This removes the insert of zero-cost units entirely. Discrepancies are still reported for admin review.

### 2. Ensure ghost cleanup works and resets errored purchases

The existing `cleanup-ghost-units` action (lines 2302-2356) is correct but was never deployed. No code changes needed — just ensure deployment.

### 3. Force-redeploy the edge function

Deploy `admin-data` immediately after making the change so the cleanup and reconciliation fixes are live.

## Execution sequence

1. Edit `admin-data/index.ts` — remove backfill insert, make it report-only
2. Deploy `admin-data` edge function
3. User clicks **Cleanup Ghost Units** → deletes 213 ghosts + resets purchases 881/1733 to pending
4. User clicks **Process Pending** → purchases 881/1733 create proper stock units with landed costs
5. User clicks **Recalc Avg Cost** → SKU averages corrected
6. User runs **Reconcile Stock** → reports only, no more ghost creation

## Files changed

| File | Change |
|------|--------|
| `supabase/functions/admin-data/index.ts` | Remove auto-backfill insert in `reconcile-stock` (lines 1548-1586), replace with report-only |

One file, one logical change, then deploy.

