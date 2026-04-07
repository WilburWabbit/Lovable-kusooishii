
Root cause confirmed from the live state:

- `landing_raw_qbo_purchase` entries for `881` and `1733` are still `status = error` with:
  `Stock unit insert failed: duplicate key value violates unique constraint "stock_unit_uid_key"`
- Matching `inbound_receipt` rows already exist for both purchases and are `pending`, but each currently has `0` receipt lines.
- There are no active `purchase_batches` for references `881` or `1733`, which means the system is in a half-reset state: some derived data was cleaned up, but the landing records themselves are still blocked in `error`.
- The current cleanup logic in `supabase/functions/admin-data/index.ts` is incorrect:
  ```ts
  await admin.from("stock_unit").delete().eq("inbound_receipt_line_id", receipt.id)
  ```
  `stock_unit.inbound_receipt_line_id` references `inbound_receipt_line.id`, not `inbound_receipt.id`, so this reset path does not actually target the right stock rows.
- `Process Pending` only processes `status = pending`, so these two purchases will not recover reliably while they remain in `error`.

Plan:

1. Fix the purchase reset logic in `supabase/functions/admin-data/index.ts`
   - Load the receipt for a given QBO purchase id.
   - Collect the real `inbound_receipt_line.id` values.
   - Delete purchase-linked stock units using those line ids.
   - Delete the matching receipt lines.
   - Delete any related `purchase_line_items` and `purchase_batches` by `reference = qboPurchaseId`.
   - Reset the landing row to `pending` and clear `processed_at` / `error_message`.

2. Add a targeted repair action for stuck QBO purchases
   - Create a dedicated admin action such as `reset-qbo-purchase`.
   - Accept one or more QBO purchase ids.
   - Use this specifically for `881` and `1733` instead of relying on the broad ghost cleanup action.

3. Harden `qbo-process-pending`
   - Before reprocessing an errored purchase, clear any stale derived purchase artifacts for that same QBO purchase id.
   - Reuse the same cleanup helper so manual reset and retry follow one deterministic path.
   - Improve the failure logging around stock-unit insert so the purchase id and batch id are captured if a UID collision ever happens again.

4. Add a UI path for this repair flow
   - In `src/components/admin-v2/StagingErrorsPanel.tsx`, add a “Reset & retry” action for QBO purchase errors.
   - Keep the existing generic Retry button for simple staging resets, but use the targeted reset for purchase-processing failures.

Files to change:
- `supabase/functions/admin-data/index.ts`
- `supabase/functions/qbo-process-pending/index.ts`
- `src/components/admin-v2/StagingErrorsPanel.tsx`

No migration is needed.

Expected result:
- Purchases `881` and `1733` move from `error` to `pending`, then process cleanly
- Receipt lines, purchase batches, line items, and stock units are recreated from QBO in the correct order
- The affected SKUs stop showing false stock discrepancies because the purchases are truly processed, not just landed
