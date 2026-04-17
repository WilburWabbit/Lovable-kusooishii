

## What's actually happening

DB state for payout `060ee447`:
- `payouts.qbo_sync_status = 'synced'`, `qbo_deposit_id = 2276` ← still set
- All `ebay_payout_transactions.qbo_purchase_id` = NULL ← expenses reset OK
- All linked `sales_order.qbo_sales_receipt_id` still set (e.g. KO-0009323 → 2275), `qbo_sync_status = 'synced'`

So:
1. The "Reset Expenses" press worked.
2. The "Reset Deposit" / "Reset All" press did **not** persist — `qbo_deposit_id` and `qbo_sync_status` on the payout row are unchanged.
3. The reset action **never** clears `sales_order.qbo_sales_receipt_id`, so even after a successful "Reset All" the app still believes the SalesReceipts exist in QBO. After you delete them in QBO, the app diverges silently.

The "Sync to QBO" button is hidden because `payout.qboSyncStatus !== "synced"` is false (line 694 of `PayoutDetail.tsx`). That's why it's greyed/missing.

## Fix — two small, surgical changes

### 1. `supabase/functions/admin-data/index.ts` — `reset_payout_sync` action

Make scope `deposit` and `all` also clear the linked sales receipts so the app's view of QBO matches reality after the user has deleted records in QBO:

- For `scope in ('deposit','all')`:
  - Continue to clear `payouts.qbo_deposit_id`, `qbo_expense_id`, `qbo_sync_status='pending'`, `qbo_sync_error=null` (existing behaviour).
  - Additionally: find every `sales_order` linked to this payout (via `payout_orders.sales_order_id` AND via `ebay_payout_transactions.matched_order_id`/`order_id → origin_reference`) and clear `qbo_sales_receipt_id = null`, `qbo_sync_status = 'pending'`, `qbo_sync_error = null`.
  - Return counts: `depositReset`, `salesReceiptsReset`.

- For `scope = 'expenses'`: keep current behaviour (clears only `ebay_payout_transactions.qbo_purchase_id`).

This makes the three reset buttons match what the UI implies: "expenses-only", "deposit + sales receipts", "everything".

### 2. `src/components/admin-v2/PayoutDetail.tsx` — make Sync button visible whenever there's work to do

Replace the gating condition on the Sync button (currently `payout.qboSyncStatus !== "synced"`) with:

```ts
const needsSync =
  payout.qboSyncStatus !== "synced" ||
  !payout.qboDepositId ||
  (qboReadiness && (qboReadiness.unsyncedOrders.length > 0 || qboReadiness.pendingExpenses.length > 0));
```

So the button is shown whenever:
- the payout itself isn't synced, OR
- there is no QBO deposit linked, OR
- any sales receipt or expense is missing.

The existing `disabled={triggerQBOSync.isPending || (qboReadiness != null && !qboReadiness.ready)}` stays, so we still block clicking until readiness passes.

### 3. Toast hardening on the reset buttons

Surface the actual server response counts so a user can immediately tell whether the reset took effect:

- "Reset Deposit" → toast `Deposit reset (1) + N sales receipts cleared`.
- "Reset All" → toast `Reset N expenses, deposit, M sales receipts`.

### 4. One-off data repair for this stuck payout

Run once after the function change deploys, against payout `060ee447-02f7-4527-84a4-95aedecd0daa` (external `7388684270`):

- `UPDATE payouts SET qbo_deposit_id = NULL, qbo_expense_id = NULL, qbo_sync_status = 'pending', qbo_sync_error = NULL WHERE id = '060ee447-…'`
- `UPDATE sales_order SET qbo_sales_receipt_id = NULL, qbo_sync_status = 'pending', qbo_sync_error = NULL WHERE origin_reference IN (the 10 SALE transaction IDs)`
- `ebay_payout_transactions.qbo_purchase_id` is already NULL — no change needed.

After this:
- "QBO Readiness" badge will read `0/10 orders synced, 0/N expenses created`.
- "Sync to QBO" button becomes visible AND enabled once each sales receipt is recreated by the existing per-order sync flow (or directly by `qbo-sync-payout`, which already invokes `qbo-sync-sales-receipt` for any order missing a receipt).

## Explicitly NOT changed

- `qbo-sync-payout`, `qbo-sync-sales-receipt`, VAT logic, ex-VAT posting model, repair loop — all untouched. The previous fix stands.
- `payout_orders` rows — left as-is.
- No schema change. No migration.

## Files

- `supabase/functions/admin-data/index.ts` — extend `reset_payout_sync` for `deposit`/`all` scope to also clear linked `sales_order.qbo_sales_receipt_id`.
- `src/components/admin-v2/PayoutDetail.tsx` — broaden Sync button visibility condition; richer reset toasts.
- One-off SQL repair for `060ee447-…`.

