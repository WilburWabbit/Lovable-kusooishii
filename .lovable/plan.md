

## User's point

The order's `gross_total` (and the per-line `unit_price` × `quantity`) is **canonical for that sale** — it's the legally-contracted amount eBay/Stripe/etc collected from the buyer at that moment in time. The app's *current* listing price is irrelevant to a historical order. So:

- A SalesReceipt's QBO `TotalAmt` must equal the **order's recorded gross**, full stop.
- It must NOT be reconciled against any current product price, current listing price, or any recomputed value.
- The previous "expected gross £15.99 vs actual £14.99" error was the eBay-channel transaction's reported gross (£14.99) being checked against something else (£15.99) — likely the order's own `gross_total` derived from current line prices, or a payout-transaction amount mismatch.

## What's actually wrong in the current code

In `qbo-sync-payout/index.ts`, when syncing SalesReceipts for SALE-type payout transactions, the function compares the **eBay payout transaction amount** against the **app order's gross_total**, and aborts if they differ. That's the bug. The eBay payout amount and the app's order gross can legitimately differ (price changes between order placement and payout, partial refunds applied at payout time, eBay fee adjustments, etc.) — and **neither validation is meaningful** because the SalesReceipt's job is simply to mirror the order as it was sold.

The SalesReceipt should be built from the **`sales_order` + `sales_order_line` rows as they exist** (that IS the canonical sale), and the only number QBO must match is the sum of those lines. The eBay payout transaction is just the cash settlement reference — it links the order to the deposit, it doesn't re-validate the sale amount.

## Investigation needed before final plan

I need to confirm exactly where the £15.99 vs £14.99 comparison happens. Three candidates:

1. `qbo-sync-payout/index.ts` — comparing `payout_transaction.amount` to `order.gross_total` before invoking sales-receipt sync.
2. `qbo-sync-sales-receipt/index.ts` — its own `assertQBOTotalMatches` post-check, where `expectedGross` is computed from order lines but the payout caller passes a different "expected".
3. The deposit-balancing step — checking `sum(sales_receipts) + sum(purchases) === payout_net` and treating any drift as an order-level error.

Reading these three files will pin down the exact comparison and let me write a precise fix.

## Fix direction (subject to confirming above)

1. **Remove the cross-validation** between payout-transaction gross and order/sales-receipt gross. The SalesReceipt is built from and validated against **only** the order's own line items. Whatever total that produces is what QBO must match.
2. **Reconcile at the deposit level, not the transaction level.** If the sum of SalesReceipts + Purchases doesn't equal the payout net, the difference is real-world: marketplace fees, refunds processed at payout time, currency conversion, etc. Surface it as a deposit-level adjustment line (or a "payout adjustment" expense), not as a per-transaction failure.
3. **Keep the QBO-vs-app per-document retry loop** that was just built — that's still correct, because *within* a single SalesReceipt or Purchase we still want QBO's TotalAmt to equal the document we sent. That's a QBO rounding fight, not a sale-amount fight.
4. **Skip-and-continue stays** for the rare case where QBO's per-line tax recompute genuinely can't be reconciled within 3 attempts.

## Files to read before finalising

- `supabase/functions/qbo-sync-payout/index.ts` — find the SALE-handling branch and the £15.99/£14.99 comparison.
- `supabase/functions/qbo-sync-sales-receipt/index.ts` — confirm `expectedGross` is sourced from `sales_order_line` only.
- `src/components/admin-v2/PayoutDetail.tsx` — how skipped/partial state is surfaced, so the deposit-adjustment story lands somewhere visible.

## Files likely to change

- `supabase/functions/qbo-sync-payout/index.ts` — drop the order/payout amount cross-check; treat any deposit-level drift as a "Payout adjustment" deposit line rather than a per-transaction error.
- `supabase/functions/qbo-sync-sales-receipt/index.ts` — confirm (and if needed, lock down) that `expectedGross` is `sum(sales_order_line.unit_price × quantity)` and nothing else. No comparison to `payouts.amount` or eBay reported gross.
- `src/components/admin-v2/PayoutDetail.tsx` — show "Payout adjustment £X.XX" line on partial deposits so it's visible, not silent.

No DB migration. No schema change.

## Open question before writing code

For the deposit-level reconciliation drift (e.g. payout settled at £222.06 but sum of mirrored sales/expenses is £222.40):

a) **Auto-balance with a "Payout adjustment" deposit line** to a configurable QBO account (e.g. an Other Income / Other Expense account), so the deposit always lands and the difference is visible in QBO for monthly review.

b) **Skip the deposit creation entirely** when there's drift, mark the payout `partial`, and surface it for manual investigation.

(a) keeps automation flowing and matches how accountants typically handle marketplace-payout rounding/fees. (b) is safer but blocks automation. I'd recommend (a) with the adjustment account configurable in QBO settings.

