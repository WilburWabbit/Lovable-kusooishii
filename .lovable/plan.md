
Fix rebuild sequencing and unify purchase replay

What is broken now
- Rebuild clears `purchase_batches` and `purchase_line_items` in `admin-data`.
- `qbo-process-pending.processPurchases()` does not recreate them; it only rebuilds `inbound_receipt`, `inbound_receipt_line`, and `stock_unit`.
- The Purchases UI (`PurchaseList` / `usePurchaseBatches`) only reads `purchase_batches`.
- The only path that currently creates batches is the Intake client mutation in `use-intake.ts`, which rebuild never calls.
- Result: purchases can be marked “processed” while the actual v2 purchase model is still empty or incomplete.

Implementation plan

1. Create one canonical server-side purchase promotion path
- Move purchase promotion into one shared server-side routine used by both rebuild and manual intake.
- Input: one `inbound_receipt`.
- Output: `purchase_batches`, `purchase_line_items`, and `stock_unit` rows with correct `batch_id`, `line_item_id`, and `inbound_receipt_line_id`.
- Make it idempotent per QBO purchase: replaying one purchase must replace that purchase’s batch/lines/units, not append.

2. Change QBO purchase processing to use that routine
- In `qbo-process-pending`, keep QBO purchase landing/normalisation into `inbound_receipt` + lines.
- Replace the current “create stock only + mark receipt processed” branch with “promote receipt into purchase batch”.
- Do not mark the QBO purchase landing row committed until batch, line items, and units all succeed.
- On error, roll back partial batch/line/unit writes and leave the record retryable.

3. Enforce the exact rebuild order
```text
Tax/reference pre-step -> Customers -> Items -> Purchases -> Sales/Refunds -> Deposits
```
- For rebuild, stop relying on the generic mixed `drainPending()` loop as the main control path.
- In `QboSettingsCard`, explicitly:
  - land one phase
  - process only that entity type until pending = 0
  - stop if errors remain
  - only then advance
- Purchases must be fully promoted before any sales run; deposits must wait until all sales/refunds are committed.

4. Remove the split-brain intake path
- Update `use-intake.ts` so manual “Process into Batch” calls the same server-side purchase promotion routine instead of writing batches/units directly from the browser.
- Align or retire `process-receipt` so there is only one authoritative receipt-to-batch implementation.

5. Add rebuild safety checks
- After the Purchases phase, verify:
  - every committed QBO purchase has one matching purchase batch
  - batch line totals/unit counts reconcile to the receipt
  - no stock units exist for a QBO purchase without `batch_id` and `line_item_id`
- If any of those checks fail, stop before Sales.

Files to update
- `supabase/functions/qbo-process-pending/index.ts`
- `src/components/admin-v2/QboSettingsCard.tsx`
- `src/hooks/admin/use-intake.ts`
- `supabase/functions/process-receipt/index.ts` or a new shared purchase-promotion helper
- `supabase/functions/admin-data/index.ts` for rebuild orchestration/reporting only

Expected result
- Rebuild follows the business sequence you specified.
- Purchases are not just cleared; they are actually rebuilt into the v2 purchase model the UI uses.
- Sales allocate against rebuilt purchase stock, and deposits reconcile only after the sales base exists.
- One bad purchase can be purged and replayed with the same code path as the full rebuild.
