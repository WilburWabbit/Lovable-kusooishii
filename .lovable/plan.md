

## Why this keeps happening

The simulator in `qbo-tax.ts` models QBO as `tax = round(SUM(taxable nets) × 0.20)`. Logs show QBO actually returns `£9.92` for nets summing to `£8.28` (which would be `8.28 + 1.66 = £9.94` per our model and `8.28 + 1.66 = £9.94` per per-line-rounding too). The model is empirically still wrong for some realm/payload combinations. We've now spent 4 rounds trying to predict QBO. The user is right: **stop predicting, start reacting.**

## Fix strategy: react to QBO, don't predict it

Treat QBO's returned `TotalAmt` as the source of truth and **iteratively correct the payload until it lands**, with a hard ceiling of 3 attempts per Purchase. If still wrong after 3, skip that single transaction and continue the payout.

### Algorithm in `qbo-sync-payout/index.ts → createQBOPurchase`

For each Purchase, in a loop (max 3 attempts):

1. Build payload with current `grossPenceLines` using existing `buildBalancedQBOLines`.
2. POST to QBO. Read `qboTotalAmt`.
3. If `toPence(qboTotalAmt) === expectedGrossPence` → done, return success.
4. Otherwise:
   - `drift = expectedGrossPence − toPence(qboTotalAmt)` (signed pence, almost always ±1p)
   - **Delete the bad Purchase from QBO** via `DELETE /purchase/{id}?operation=delete` so QBO doesn't keep an orphan.
   - Adjust the payload: append (or grow) a **zero-tax "Rounding adjustment" line** by `drift` pence. Because that line uses TaxCodeRef "10" (No VAT), QBO will not recompute tax on it — it shifts `TotalAmt` by exactly `drift` regardless of whatever recompute QBO did to the standard lines.
   - Loop.
5. After 3 failed attempts:
   - Delete the last bad Purchase.
   - Return `{ skipped: true, reason: "QBO total drift unresolvable after 3 attempts", lastQboTotal, expected }` instead of throwing.

### How the caller handles a skipped transaction

In the main payout loop:

- On `skipped`: write `qbo_sync_error` on that single `ebay_payout_transactions` row, leave its `qbo_purchase_id` NULL, increment a `skipped` counter. Do **not** abort the payout.
- After processing all transactions: if `skipped > 0`, build the deposit only from successfully-linked transactions. Mark the payout `qbo_sync_status = "partial"` with a clear message listing skipped transaction IDs. Surface this in the response and on the payout detail page so the user can investigate the handful of edge cases instead of being blocked by them.

### Why a "rounding adjustment" line guarantees convergence in ≤2 attempts

The first attempt either lands or drifts by a small integer pence amount `d`. We add a No-VAT line of exactly `d` pence. QBO's per-line VAT recompute touches only standard-rated lines (unchanged), so the new `TotalAmt` is exactly old `TotalAmt + d = expected`. Convergence is mathematically guaranteed on attempt 2 unless QBO behaves non-deterministically (the 3rd attempt covers that).

### Defence retained

- Pre-flight `assertQBOPayloadBalances` stays — still useful as a fast fail before the first POST.
- Post-create `assertQBOTotalMatches` is now caught and drives the retry/skip flow instead of throwing all the way out.
- All payload variants and QBO responses logged with `attempt`, `drift`, `qboTotalAmt` for forensic review.

### Apply same retry-and-skip to SalesReceipts

Mirror the loop in `qbo-sync-sales-receipt/index.ts`. SalesReceipts are per-order so "skip" means marking that single order `qbo_sync_status = "error"` and returning, which is already the existing failure behaviour — only the retry-with-rounding-line addition is new.

## Files

- `supabase/functions/qbo-sync-payout/index.ts` — wrap `createQBOPurchase` in retry loop, add QBO Purchase delete, change return type to allow `{ skipped: true, ... }`. Update caller to handle skip and mark payout `partial`.
- `supabase/functions/qbo-sync-sales-receipt/index.ts` — same retry-with-rounding-line loop, max 3.
- `supabase/functions/_shared/qbo-tax.ts` — small helper `growRoundingLine(stableLines, deltaPence)` used by the retry path.
- `src/components/admin-v2/PayoutDetail.tsx` — render `partial` status and the skipped-transaction list (read-only, no behavioural change).

No DB migration. No schema change.

## Existing data repair for current payout

After deploy, for `060ee447-02f7-4527-84a4-95aedecd0daa`:
1. Delete in QBO any over/undertotalled Purchase (Ref 2135 + recent failed siblings) and any Deposit linked to this payout.
2. `UPDATE payouts SET qbo_deposit_id = NULL, qbo_sync_status = 'pending' WHERE id = '060ee447-02f7-4527-84a4-95aedecd0daa';`
3. `UPDATE ebay_payout_transactions SET qbo_purchase_id = NULL, qbo_sync_error = NULL WHERE payout_id = (SELECT external_payout_id FROM payouts WHERE id = '060ee447-02f7-4527-84a4-95aedecd0daa');`
4. Re-run sync. Worst case a couple of transactions get auto-corrected in a 2nd attempt; expected gross of £222.06 is reached. If any transactions still fail after 3 attempts, payout completes as `partial` with those transactions clearly flagged for follow-up.

