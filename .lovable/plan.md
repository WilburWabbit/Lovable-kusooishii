

## Diagnosis: Duplicate stock units in the inventory pipeline

### Root cause

There are **9 receipt lines with excess stock units** (some with 2x or 3x the expected quantity). Two independent bugs cause this:

**1. Race condition in `qbo-webhook` Purchase handler (lines 153-288)**

When QBO fires two rapid notifications for the same Purchase (common — the logs show duplicate deliveries), both requests:
- Upsert the receipt → both see `status = pending`
- Delete and recreate receipt lines
- Create stock units
- Set status to `processed`

The `if (receipt.status === "processed") return` guard on line 171 fails because both requests read `pending` before either finishes.

**2. No shortfall guard in either stock-creation path**

Neither `handlePurchase` (webhook) nor `process-receipt` (manual) checks how many stock units already exist for a receipt line before inserting. The memory note about "idempotency guard / shortfall calculation" describes the intended design, but neither function actually implements it.

### Fix

Add a **shortfall check** before inserting stock units in both functions. For each receipt line, count existing `stock_unit` rows linked to that `inbound_receipt_line_id` and only insert the difference:

```text
expected = line.quantity
existing = COUNT(*) FROM stock_unit WHERE inbound_receipt_line_id = line.id
shortfall = expected - existing
if shortfall <= 0 → skip
else → insert only shortfall units
```

This is idempotent regardless of concurrent execution or re-processing.

Additionally, add a **data cleanup migration** to delete the excess duplicate stock units that already exist.

### Changes

| File | Change |
|------|--------|
| `supabase/functions/qbo-webhook/index.ts` | Add shortfall check before stock unit insert in `handlePurchase` (~line 269-284) |
| `supabase/functions/process-receipt/index.ts` | Add shortfall check before stock unit insert (~line 150-165) |
| Database migration | Delete excess duplicate stock units for the 9 affected receipt lines, keeping the oldest N (where N = expected quantity) |

### Cleanup query logic

For each affected line, identify the IDs to keep (oldest `created_at`, limited to `quantity`) and delete the rest. This will remove ~11 excess units across 9 lines.

