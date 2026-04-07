

# Fix: Reset Errored Purchases and Enhance Ghost Cleanup

## Problem

The ghost unit cleanup succeeded (238 units deleted), but the **2 errored purchases** (QBO IDs 881 and 1733) remain stuck with `status = 'error'` in `landing_raw_qbo_purchase`. The cleanup action only deletes orphan stock units — it does not reset the landing records that caused them.

- **Purchase 881**: 144 units of `10349-1.1` (Happy Plants) — this is why that SKU has 0 stock units but 22 sales lines
- **Purchase 1733**: ~50+ mixed items (minifigs, electronics) — explains missing units for `bob029`, `col083`, `col091`, etc.

Both purchases previously failed with `duplicate key value violates unique constraint "stock_unit_uid_key"` because ghost units occupied those UIDs. Now that ghosts are gone, retrying will succeed — but nothing triggered the retry.

## Fix

### 1. Enhance `cleanup-ghost-units` action (admin-data/index.ts)

After deleting ghost units, automatically reset any `error` status landing purchases back to `pending` (only those with UID-related errors, to be safe). Also delete their partial `inbound_receipt_line` records so the processor starts fresh.

Add after the ghost deletion loop (around line 2329):

```typescript
// Reset errored purchases that failed due to UID conflicts
const { data: erroredPurchases } = await admin
  .from("landing_raw_qbo_purchase")
  .select("id, external_id")
  .eq("status", "error")
  .ilike("error_message", "%duplicate key%");

let resetCount = 0;
for (const ep of (erroredPurchases ?? [])) {
  // Clean up partial receipt lines and stock units for this purchase
  const { data: receipt } = await admin
    .from("inbound_receipt")
    .select("id")
    .eq("qbo_purchase_id", ep.external_id)
    .maybeSingle();
  if (receipt) {
    await admin.from("stock_unit").delete().eq("inbound_receipt_line_id", receipt.id);
    await admin.from("inbound_receipt_line").delete().eq("inbound_receipt_id", receipt.id);
  }
  // Reset to pending
  await admin
    .from("landing_raw_qbo_purchase")
    .update({ status: "pending", error_message: null, processed_at: null })
    .eq("id", ep.id);
  resetCount++;
}
```

Update the result message to include reset count.

### 2. Immediately reset the 2 stuck purchases (one-time fix)

Since the user has already run cleanup, the plan should also include resetting those 2 records right now. The cleanup action enhancement ensures this happens automatically in the future, but for now we also need to handle the existing errors.

The enhanced cleanup action will catch these on re-run, or we add a dedicated "retry errored purchases" step in the cleanup flow.

### 3. Update cleanup button UX (QboSettingsCard.tsx)

After cleanup completes, if errored purchases were reset, show a toast suggesting the user run "Process Pending" to complete the processing.

## Changes

| File | Change |
|------|--------|
| `supabase/functions/admin-data/index.ts` | Extend `cleanup-ghost-units` to reset UID-errored landing purchases to pending and clean partial receipt data |
| `src/components/admin-v2/QboSettingsCard.tsx` | Update cleanup success toast to mention reset purchases and prompt processing |

## Expected outcome

After deploying and re-running "Cleanup Ghost Units" → "Process Pending":
- Purchase 881 processes successfully → 144 `10349-1.1` stock units created with correct landed costs
- Purchase 1733 processes successfully → ~50+ mixed units created
- `avg_cost` recalculation produces correct values
- Stock reconciliation shows parity for all affected SKUs

