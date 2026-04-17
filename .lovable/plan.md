

## Understanding the correction

I was wrong in my last message. Re-stating the rule so I don't break it again:

- QBO SalesReceipts and Purchases are deliberately built **ex-VAT** (`UnitPrice = net`, `TaxCodeRef = 20% standard`, `GlobalTaxCalculation = "TaxExcluded"`) because QBO's `TaxInclusiveAmt` flag is unreliable.
- QBO then recomputes VAT per line, and the existing 3-attempt rounding-stable loop in `qbo-sync-sales-receipt` (and the equivalent path for purchases) drives QBO's resulting `TotalAmt` to land **exactly on the canonical gross**.
- That mechanism is correct and must not be touched.

So the previous SalesReceipt for `KO-0009323` landing at £14.99 is NOT a "VAT handling bug". It is exactly what the system is designed to do: it built the receipt from `sales_order.gross_total = 14.99`, and QBO's TotalAmt converged on 14.99. The fault is upstream — `sales_order.gross_total` is wrong (should be 15.99 per `ebay_payout_transactions.gross_amount`).

## The actual remaining bug

The auto-rebuild path in `qbo-sync-payout` is failing at the wrong gate.

Current behaviour (after the last change):
1. Compares the QBO SalesReceipt `TotalAmt` against `ebay_payout_transactions.gross_amount`.
2. Detects mismatch (£14.99 vs £15.99).
3. Should: repair `sales_order.gross_total` → re-run `qbo-sync-sales-receipt` → re-verify.
4. Actually: returns 422 before completing the repair+rebuild cycle for that single line.

So the canonical-drift detector is firing, but the per-order repair-and-rebuild loop is short-circuiting and aborting the whole payout instead of fixing the one bad sale and continuing.

## Fix (scope strictly limited)

Single concern: make the per-transaction "detect drift → repair sales_order → rebuild SalesReceipt → re-verify" loop in `supabase/functions/qbo-sync-payout/index.ts` actually run to completion for each affected sale, then proceed with the deposit.

### 1. `qbo-sync-payout/index.ts` — fix the per-line auto-rebuild loop only

For every SALE transaction, before adding its deposit line:

a. Read canonical gross = `ebay_payout_transactions.gross_amount`.
b. Read current QBO SalesReceipt `TotalAmt`.
c. If they differ:
   - Repair `sales_order.gross_total` + `sales_order_line.unit_price` so the order's gross equals canonical (ex-VAT unit price = `round(canonical / 1.2, 2)`, with last-line residual absorbed so `qbo-sync-sales-receipt`'s existing 3-attempt loop converges to canonical to the penny — same mechanism it uses today, no change to that function).
   - Write `price_audit_log` entry (`reason: 'payout_canonical_repair'`).
   - Delete the stale QBO SalesReceipt via existing `deleteQBOSalesReceipt`.
   - Clear `sales_order.qbo_sales_receipt_id` + `qbo_sync_status`.
   - Invoke `qbo-sync-sales-receipt` for that order (it will build ex-VAT lines and converge to canonical gross — no change to its VAT handling).
   - Re-fetch the new SalesReceipt's `TotalAmt`.
   - Only if it still doesn't match → mark payout `error` and return 422.
d. Otherwise continue.

Apply the **same loop** to expense (`Purchase`) lines: detect mismatch vs `Math.abs(ebay_payout_transactions.gross_amount)`, delete + recreate via the existing purchase sync path (which is also ex-VAT today), re-verify.

### 2. What I will NOT change

- `qbo-sync-sales-receipt/index.ts` — untouched. Stays ex-VAT (`GlobalTaxCalculation: "TaxExcluded"`, `UnitPrice = net`, `TaxCodeRef` 20%), with its existing 3-attempt rounding-stable convergence loop.
- The purchase sync path — untouched. Stays ex-VAT.
- `vat.ts` / `qbo-tax.ts` — untouched.
- Pre-POST balance assertion and post-POST deposit `TotalAmt` verification (added previously) — kept as-is. They are the safety net that prevents silent under/over-deposits.
- The "no £1 fudge / no settlement adjustment line" rule — kept.

### 3. Re-run the stuck payout

After the loop fix:
- `KO-0009323` already has `sales_order.gross_total = 15.99` (restored earlier).
- A SalesReceipt was just created for it (10/10 readiness reached momentarily), then the payout sync 422'd. Re-trigger `qbo-sync-payout` for `060ee447-…`. The loop now sees TotalAmt = 15.99 = canonical and proceeds without touching it. Deposit lands at exactly £222.06. Status `synced`.

If for any reason the receipt for `KO-0009323` was rolled back, the same loop will detect the drift, repair, rebuild, and converge.

### 4. Files

- `supabase/functions/qbo-sync-payout/index.ts` — only the per-line auto-rebuild loop (sales + expenses). No other change.

No schema change. No migration. No change to any other edge function.

## Expected outcome

- Sale and expense docs that don't match the eBay payout record get repaired in-place (one at a time) using the existing ex-VAT receipt/purchase generators.
- Deposit balances to `payout.net_amount` exactly.
- Payout `060ee447-…` syncs cleanly to £222.06.
- No change to QBO VAT handling. No fudge lines. No assumption changes.

