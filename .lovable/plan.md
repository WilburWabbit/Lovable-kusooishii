

## Root cause

The payout has these moving parts:

| Type | Amount | Purpose |
|---|---|---|
| 10 SALE | +£301.89 gross, −£45.55 fees | Sales receipts |
| 10 SHIPPING_LABEL | −£33.16 | Shipping costs |
| NON_SALE_CHARGE "Insertion Fee" (£0.12) | −£0.12 | Listing fee |
| **NON_SALE_CHARGE "Invoice 2026-02-28 → 2026-03-30" (£32.40)** | −£32.40 | Monthly store subscription invoice |
| **TRANSFER `TRANSFER_FROM` (£32.40)** | +£32.40 | eBay paying the invoice from undeposited funds |

eBay's `net_amount` of **£222.06** is the actual cash payout — it already accounts for the subscription being paid via the TRANSFER (the TRANSFER cancels the NON_SALE_CHARGE invoice).

The current code (lines 355–359) **excludes TRANSFERs** from expense processing on the assumption that the matching NON_SALE_CHARGE represents the same money already. The reasoning was correct in principle — you don't want to double-count — but the **direction is inverted for invoice-style charges**:

- For a **subscription/invoice charge**, eBay issues an invoice (NON_SALE_CHARGE +£32.40) and then immediately pays it (TRANSFER +£32.40 OUT). Both together = zero net effect on the payout. eBay's `net_amount` reflects this zero impact.
- The current code keeps the NON_SALE_CHARGE as a £32.40 deduction and drops the TRANSFER → the deposit is £32.40 short.

For an **insertion fee** (£0.12), there is no matching TRANSFER — eBay deducts it directly from this payout. So it correctly belongs as a deduction.

So the rule is: **a NON_SALE_CHARGE that has a matching TRANSFER in the same payout has already been settled and should NOT be deducted from the deposit.** The Purchase still gets created in QBO (the expense is real), but it should be booked against the bank account directly (or against an "eBay Subscriptions" liability), not against Undeposited Funds, because Undeposited Funds is never debited for it in this payout.

## Fix

### Single change in `supabase/functions/qbo-sync-payout/index.ts`

1. **Detect "settled" NON_SALE_CHARGE transactions** — for each NON_SALE_CHARGE, check if there's a TRANSFER with the same absolute `gross_amount` in `allTransactions`. Tag these as `settled_via_transfer`.

2. **For settled NON_SALE_CHARGEs:**
   - Still create a QBO Purchase (the expense is real and should hit the P&L), but book it against the **bank account directly** (`payout_bank`), not Undeposited Funds. This represents "eBay paid this invoice on our behalf out of separate funds" — which in QBO terms is a direct bank-paid expense.
   - **Skip adding it as a negative deposit line** — Undeposited Funds wasn't touched for this charge in this payout.

3. **For unsettled NON_SALE_CHARGEs (e.g. insertion fees):** keep current behaviour — Purchase against Undeposited Funds, negative line on the deposit.

4. **TRANSFER handling:** keep the existing exclusion comment, but update it to reflect the new model: TRANSFER is informational only — it tells us the matching NON_SALE_CHARGE was paid out-of-band and shouldn't reduce this payout's deposit.

### Result
- Constructed deposit becomes 189.66 + 32.40 = **£222.06** ✓ matches `net_amount`
- The £32.40 subscription is still recorded as a Purchase in QBO (booked to subscription_fees, paid from bank), so the P&L is unaffected
- Undeposited Funds clears correctly: every penny that was added to UF (sales gross) is matched by either a deposit line or a Purchase debiting UF

### Files
- `supabase/functions/qbo-sync-payout/index.ts` — add TRANSFER lookup map, branch NON_SALE_CHARGE handling on `settled_via_transfer`, change `bankAccountRef` for settled charges, skip them in the deposit-line loop.

No DB migrations or schema changes needed.

