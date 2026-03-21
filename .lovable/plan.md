

## Fix: Inventory Totals and Orphan Cleanup

### Issues

1. **Summary cards ignore filters**: The four header cards (Total Units, Carrying Value, Available, Received) always compute from the full `units` array, not from `filtered`. When you apply a search, status, or grade filter, the cards don't change.

2. **`list-stock-units` capped at 1000 rows**: The query has `.limit(1000)`, so if you have 300+ stock units the data may be complete now, but this will silently truncate as inventory grows. Should be raised or paginated.

3. **Rebuild leaves orphaned closed stock units**: Step 3 of `rebuild-from-qbo` only deletes orphans with status `available/received/graded`. Orphaned **closed** units (created by earlier buggy sales processing where `inbound_receipt_line_id` is null) survive the rebuild. These get counted and inflated the totals. The `cleanup-orphaned-stock` action also only targets `available` status.

### Changes

**File: `src/pages/admin/InventoryPage.tsx`**

- Change summary card computations from `units` → `filtered`:
  - Total Units: `filtered.length`
  - Carrying Value: sum of `filtered` carrying values
  - Available: count of `filtered` with status `available`
  - Received: count of `filtered` with status `received`

**File: `supabase/functions/admin-data/index.ts`**

- `list-stock-units`: Remove `.limit(1000)` or raise to 5000
- `rebuild-from-qbo` Step 3: Delete ALL orphaned stock units regardless of status (remove the `.in("status", [...])` filter) — any unit with `inbound_receipt_line_id = null` after receipts are deleted is orphaned
- `cleanup-orphaned-stock`: Same fix — delete orphans in any status, not just `available`

### Files Modified

1. `src/pages/admin/InventoryPage.tsx` — summary cards use filtered data
2. `supabase/functions/admin-data/index.ts` — remove limit, fix orphan cleanup to include all statuses
