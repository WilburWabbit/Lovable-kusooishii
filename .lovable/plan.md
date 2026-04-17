

## What "9/10" actually means

The "QBO Readiness: 9/10 orders synced" badge counts how many of the 10 eBay SALE transactions have a linked `sales_order` with a `qbo_sales_receipt_id`. Right now:

- 9 orders have a SalesReceipt
- 1 order does not: `KO-0009323` (eBay reference `24-14326-19004`)

That's `KO-0009323`'s SalesReceipt `1668` which was deleted as part of the canonical repair. It hasn't been recreated yet, so readiness correctly reports 9/10.

## But there's a real bug behind this

While verifying, I found a separate, worse bug in the live data:

`payout_orders` for this payout has **12 rows** but eBay only paid for **10 sales**. The two extras don't belong:

- `KO-0009312` / `05-14355-58903` — not in this payout
- `KO-0009327` / `24-14326-19005` (£360) — not in this payout

These were over-linked by the fallback in `supabase/functions/v2-reconcile-payout/index.ts` (lines ~80–103): when no `payout_orders` exist yet, it sweeps every `sales_order` on the same channel within a 14-day window and links them all. That fallback is what's polluting `payout_orders` (sum = £679.54 vs payout net £222.06).

The new `qbo-sync-payout` deposit-construction logic correctly ignores `payout_orders` and works from `ebay_payout_transactions` instead, which is why the deposit math is still right — but the UI uses `payout_orders` for the per-order table, so the user sees ghost rows and inflated figures, and any future reconciliation logic that trusts `payout_orders` is unsafe.

## Fix

Two things, smallest possible changes:

### 1. Recreate the missing SalesReceipt for `KO-0009323`

Trigger `qbo-sync-sales-receipt` for sales_order `6a5dadc9-d17f-4546-bfe6-92ecbd763e16`. Its `gross_total` is now the canonical `£15.99`, so the new SalesReceipt will land at exactly £15.99. Readiness will then show `10/10` and the deposit will balance to `£222.06`.

### 2. Stop the over-linking in `v2-reconcile-payout`

Remove the channel + date-range fallback that auto-links every order in a window. Replace with a strict match: only link a `sales_order` to a payout when its `origin_reference` matches an `ebay_payout_transactions.order_id` for that `payout_id` (or, for Stripe, when the payment_intent matches). This is the exact same canonical-source rule we just enforced for sale amounts, applied to which orders belong to a payout in the first place.

Also clean up the two ghost rows already in `payout_orders` for the current payout so the UI stops showing them.

### 3. Fix the React ref warning (cosmetic)

`Mono` in `src/components/admin-v2/ui-primitives.tsx` is rendered inside table cells where Radix tooltips try to attach a ref. Wrap the component in `React.forwardRef` so the warning stops. Pure cosmetic, no behaviour change.

## Files

- `supabase/functions/v2-reconcile-payout/index.ts` — remove date-range fallback, require canonical channel-transaction match.
- `src/components/admin-v2/ui-primitives.tsx` — `forwardRef` on `Mono`.
- One-off SQL repair — delete the two ghost `payout_orders` rows for payout `060ee447…`, then trigger `qbo-sync-sales-receipt` for `KO-0009323`, then re-run `qbo-sync-payout`.

No schema change.

## Expected outcome

- Readiness becomes `10/10 orders synced`
- `payout_orders` contains exactly the 10 real eBay sales for this payout
- QBO deposit is recreated at exactly `£222.06`
- Future payouts can never silently sweep in unrelated orders

