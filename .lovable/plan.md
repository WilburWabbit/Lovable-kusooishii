

## Investigation Results: Duplicate Stock Units

### Root Cause

The `qbo-sync-purchases` function has a **missing idempotency guard** in `autoProcessReceipt`. When the sync runs, it creates stock units for each receipt line without checking if units already exist for that line. If the sync was triggered multiple times concurrently (or a race condition prevented the "processed" status from being committed before a second run started), duplicate stock units were created.

**Scale of the problem**: 38 receipt lines affected, **69 excess stock units** across the entire inventory.

### 75397-1 Specifics

The raw QBO payload actually shows **6 units purchased** across two transactions (not 3):
- Purchase 813 (12 Dec 2024): qty **2** at £240 each
- Purchase 819 (19 Dec 2024): qty **4** at £240 each

The system created **12 stock units** (exactly 2x what it should have). If QBO truly should only show 3, that discrepancy lives in your QBO data itself — worth verifying there.

### Fix Plan

#### 1. Data Cleanup — Delete 69 duplicate stock units

Run a cleanup that, for each over-counted receipt line:
- Keeps exactly `quantity` stock units (the receipt line's qty)
- Preserves units with non-available statuses (e.g. "closed") first, then keeps the oldest "available" units
- Deletes the excess

#### 2. Bug Fix — Add idempotency guard to `autoProcessReceipt`

Before creating stock units for a receipt line, count existing units linked to that `inbound_receipt_line_id`. Only create the shortfall (if any). This prevents duplicates on re-runs.

```text
Before (current):
  for each line → insert `quantity` stock units (always)

After (fixed):
  for each line →
    count existing units WHERE inbound_receipt_line_id = line.id
    shortfall = quantity - existing_count
    if shortfall > 0 → insert only `shortfall` units
```

### Files Changed

| File | Change |
|------|--------|
| `supabase/functions/qbo-sync-purchases/index.ts` | Add existing-unit check before insert in `autoProcessReceipt` |
| Database migration | One-time cleanup query to delete 69 excess stock units |

