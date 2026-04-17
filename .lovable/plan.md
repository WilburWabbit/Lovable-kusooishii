<final-text>
## Root cause

Yes — the active penny drift is coming from the **expense path**, not the deposit header.

I checked the payout record, the payout sync logic, the raw QBO purchases, and the source eBay transaction data:

- The payout sync function reconciled the deposit to **£222.06** before sending it.
- But one linked QBO **Purchase** was created with the wrong total:
  - eBay fee source total for sale `02-14338-32191`: **£9.93**
  - fee components: **£9.16 + £0.29 + £0.48 = £9.93**
  - landed QBO Purchase `2016`: **£9.92**

Why that happened:
- `createQBOPurchase()` in `supabase/functions/qbo-sync-payout/index.ts` currently converts each fee line from gross to ex-VAT **line by line** and rounds each line separately.
- That loses a penny on this exact set of fee amounts.
- The Deposit then links to the actual QBO Purchase total, so QBO effectively uses **£9.92** instead of **£9.93**, which pushes the final deposit to **£222.07**.

So the earlier deposit-header-only theory was incomplete. The real fix needs to start at the **expense document creation**.

## Plan

### 1. Fix payout expenses to post from exact gross values
Update `supabase/functions/qbo-sync-payout/index.ts` so payout-created **Purchases** are handled as **tax-inclusive/gross-exact** documents, while **SalesReceipts stay tax-exclusive**.

This matches your rule:
- Sales receipts: tax-exclusive
- Expenses: tax-inclusive where supported

### 2. Move all reconciliation math to integer pence
Add a shared helper for outbound QBO calculations that:
- converts source amounts to **integer pence**
- computes per-line net/tax safely
- applies any rounding remainder to the final line
- converts back to 2dp only at payload creation

This removes floating-point drift and makes “exact to the penny” enforceable.

### 3. Add exact-balancing safeguards for every QBO document
After creating any outbound financial document, immediately verify:
- expected gross total from app/source
- actual QBO returned total
- actual QBO returned tax total

If the totals are not exact after 2dp normalization, stop and mark the sync as error.

For payout sync specifically:
- do **not** create the Deposit if any linked Purchase or SalesReceipt total is off by even **£0.01**

### 4. Build the Deposit from verified linked totals
Change the payout flow so the Deposit is built only after all linked Purchases/SalesReceipts have passed exact-total validation.

Add a final guard comparing:
- payout net from source
- verified linked sales totals
- verified linked expense totals
- final deposit total

If those do not reconcile exactly, fail before posting.

### 5. Apply the same safeguard pattern across all outbound QBO writers
Refactor the shared exact-total logic into reused helpers and apply it to:

- `supabase/functions/qbo-sync-payout/index.ts`
- `supabase/functions/qbo-sync-sales-receipt/index.ts`
- `supabase/functions/qbo-retry-sync/index.ts`
- `supabase/functions/ebay-process-order/index.ts`
- `supabase/functions/qbo-sync-refund-receipt/index.ts`

This gives one consistent rule: **no outbound QBO document is accepted unless line totals, tax totals, and document totals reconcile exactly**.

## Existing data repair

After the code fix is deployed, the bad records need to be recreated from corrected logic:

1. Delete the incorrect QBO Deposit for this payout.
2. Delete the payout-created QBO Purchase(s) created with the old rounding logic — safest is all Purchases for this payout, not just the known £9.92 one.
3. Clear:
   - `payouts.qbo_deposit_id`
   - related `ebay_payout_transactions.qbo_purchase_id`
4. Re-run payout sync.

If only the Deposit is deleted and recreated, it will still link to the old mis-rounded Purchase and the penny issue can persist.

## Technical details

- Confirmed mismatch:
  - source fee total: **£9.93**
  - landed QBO Purchase total: **£9.92**
- Current broken path:
  - `createQBOPurchase()` in `supabase/functions/qbo-sync-payout/index.ts`
- No database migration is needed.
- This is an edge-function refactor plus stricter reconciliation/validation.
</final-text>