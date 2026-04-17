

## Root cause

Both previous attempts got the QBO tax-mode contract wrong. The latest logs prove it:

- Payload: `Amount: 2.94` + `TaxCodeRef: 6` + `GlobalTaxCalculation: "TaxInclusive"`
- QBO returned: `TotalAmt: 3.53` = **2.94 × 1.20 exactly**

So QBO is **ignoring `GlobalTaxCalculation: "TaxInclusive"` on the Purchase document** in this UK realm and falling back to the default (treat `Amount` as net, add VAT from `TaxCodeRef` on top). This is consistent across every failing line in the log (2.94→3.53, 3.55→4.26, 4.52→5.42, all ×1.20).

Meanwhile the SalesReceipt path **works** because it uses the opposite contract: `TaxExcluded` + net `Amount` + explicit `TxnTaxDetail.TotalTax`. QBO honours that, and the post-create assert passes.

## Fix

Mirror the working SalesReceipt contract for Purchases. Stop relying on `TaxInclusive`.

In `supabase/functions/qbo-sync-payout/index.ts`, change `createQBOPurchase`:

1. Convert source gross per line to integer pence.
2. Use `distributeLinesByGrossPence` (already in `_shared/vat.ts`) to split into per-line `{ netPence, vatPence }` with the rounding remainder pushed to the last line, guaranteeing `sum(net) + sum(vat) = sum(gross)` exactly.
3. Build payload with:
   - `GlobalTaxCalculation: "TaxExcluded"`
   - Each line `Amount = lineNet` (ex-VAT, 2dp from pence)
   - `AccountBasedExpenseLineDetail.TaxCodeRef: { value: "6" }`
   - For item-linked lines: `UnitPrice = unitNet`, same `TaxCodeRef`
   - `TxnTaxDetail: { TotalTax: totalVatPounds }`
4. Keep the existing `assertQBOTotalMatches` guard — `expectedGross` stays as the original source gross. After the fix, QBO `TotalAmt` will equal exactly that.

No other changes. The deposit construction and reconciliation logic downstream are already correct (they use the verified linked totals).

## Why this works

- This is the exact same recipe QBO is currently accepting for SalesReceipts in the same realm — proven to land at the correct gross to the penny.
- Integer-pence distribution removes any per-line rounding drift.
- The `TotalTax` we send equals the sum of the exact per-line VAT pence, so QBO has no opportunity to recompute and produce a different total.

## Existing data repair

After the new code is deployed, recreate the bad records:

1. Delete in QBO: any Purchases created during the failing payout sync attempts (Refs 2089–2095 from the latest logs, plus any earlier failed batch) and the existing Deposit if one exists for this payout.
2. Clear DB pointers for payout `060ee447-02f7-4527-84a4-95aedecd0daa`:
   - `payouts.qbo_deposit_id = NULL`
   - `ebay_payout_transactions.qbo_purchase_id = NULL` for rows in that payout
3. Re-run the payout sync.

Each Purchase should now land at the exact source gross, the assert guard should pass, and the Deposit should construct to **£222.06** to the penny.

## Files

- `supabase/functions/qbo-sync-payout/index.ts` — rewrite tax handling in `createQBOPurchase` (TaxExcluded + net amounts + TxnTaxDetail.TotalTax). Use `distributeLinesByGrossPence` from the shared helper for exact pence math.

No DB migration. No schema change. No other edge functions touched.

