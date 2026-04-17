

## Root cause (definitive, from logs)

Failure: `expected gross £9.93, QBO returned TotalAmt £9.94`.

Payload we sent (TaxExcluded recipe):
- Lines: `Amount: 7.63 + 0.24 + 0.41 = 8.28` (net)
- `TxnTaxDetail.TotalTax: 1.65`
- Expected: 8.28 + 1.65 = **£9.93**

What QBO actually did:
- 7.63 × 0.20 = 1.526 → **1.53**
- 0.24 × 0.20 = 0.048 → **0.05**
- 0.41 × 0.20 = 0.082 → **0.08**
- Recomputed tax: **1.66**, ignoring our `TotalTax: 1.65`
- Result: 8.28 + 1.66 = **£9.94**

**QBO recomputes VAT per-line for Purchases and overrides our document-level `TxnTaxDetail.TotalTax`.** Our integer-pence math is correct; QBO's behaviour is the problem. Sending `TotalTax` is theatre — QBO ignores it.

The previous "Sainsbury" SalesReceipt path appears to work only because we haven't yet hit a fee combination where per-line rounding diverges from document rounding. It is exposed to the exact same bug.

## The definitive fix: build payloads QBO can't drift on

There is exactly one reliable way to get penny-exact totals out of QBO when it recomputes tax per line: **construct line `Amount` values such that QBO's own per-line `round(Amount × 0.20)` sums back to the source gross**. Don't fight QBO — pre-solve for its arithmetic.

### Algorithm: "QBO-stable line distribution"

Given a target gross `G_pence`:

1. Compute target net pence `N = round(G / 1.20)` and target tax pence `T = G − N`.
2. Take the source line gross amounts (e.g. fee components 9.16 + 0.29 + 0.48).
3. For each line, compute candidate `lineNet_pence = round(lineGross / 1.20)` and `lineTax_pence = round(lineNet × 0.20)`.
4. Sum candidate `lineNet` and candidate `lineTax`.
5. If `sum(lineTax) ≠ T`, adjust the **largest** line's net by ±1p in the direction that fixes the per-line tax sum. Re-check. Repeat (worst case 1–2 lines need a 1p adjustment; mathematically bounded).
6. If absolutely no per-line net combination yields the target (rare for grade-1 odd cases), **add a balancing micro-line**:
   - One extra `AccountBasedExpenseLineDetail` line with `Amount = ±0.01`, `TaxCodeRef` = zero-rated/exempt code, and a clear description like `"Rounding adjustment"`. This line carries no tax, so it shifts the document gross by exactly 1p without touching QBO's per-line VAT recompute.
7. Drop `TxnTaxDetail.TotalTax` from the payload entirely. It's ignored — sending it is misleading and adds confusion when reading payloads in QBO.

This is the supermarket-receipt strategy: every line balances under the system's own recompute rules, and any unavoidable rounding lives in an explicit, auditable rounding line.

### Why this works where the current code fails

- We stop relying on QBO honouring `TxnTaxDetail.TotalTax` (it doesn't, for Purchases).
- We pre-validate the document under QBO's own arithmetic *before* sending it. If the simulated `sum(round(net × 0.20))` doesn't equal `expectedTax`, we either re-balance or insert a rounding line.
- The `assertQBOTotalMatches` guard becomes a true safety net rather than the primary defence — it should never fire after this fix.

### Apply consistently across all outbound QBO writers

Move the line-distribution logic into `supabase/functions/_shared/qbo-tax.ts`:

- `buildQBOStableLines(grossPenceLines: number[]): { netPence, taxPence }[]` — the core algorithm above.
- `simulateQBOTotal(lines): { totalNetPence, totalTaxPence, totalGrossPence }` — mirrors QBO's per-line recompute exactly.
- `appendRoundingLineIfNeeded(lines, expectedGrossPence)` — adds the ±1p zero-tax balancer when math can't be solved otherwise.
- `assertQBOPayloadBalances(payload, expectedGrossPence)` — pre-flight check before POST. Throws if simulated total ≠ expected, with full diagnostic.

Use it in:
- `supabase/functions/qbo-sync-payout/index.ts` — `createQBOPurchase`
- `supabase/functions/qbo-sync-sales-receipt/index.ts` — SalesReceipt builder
- `supabase/functions/qbo-sync-refund-receipt/index.ts`
- `supabase/functions/qbo-retry-sync/index.ts`
- `supabase/functions/ebay-process-order/index.ts`

### Safeguards retained

- Pre-flight: `assertQBOPayloadBalances` — fails before any POST if simulated total drifts.
- Post-create: `assertQBOTotalMatches` — fails after POST if QBO does something unexpected (defence in depth).
- Cached-doc check: continue verifying linked Purchases/SalesReceipts via `fetchQBODocTotal` before building the Deposit.

### Settings for the rounding line

Need a QBO account configured for "Rounding adjustments" (zero-tax). Two options:
- Reuse `selling_fees` with a zero-rated `TaxCodeRef` on the rounding line only.
- Add a new mapping purpose `rounding_adjustment` in `qbo_account_mapping`.

Default to the simpler option (selling_fees + zero-rated tax code) and only add a dedicated mapping if the user wants a separate trail.

## Existing data repair

After deploy:

1. Delete in QBO the bad Purchases from this latest run (Refs around 2112 and adjacent failed siblings) and any Deposit linked to payout `060ee447-02f7-4527-84a4-95aedecd0daa`.
2. Clear `payouts.qbo_deposit_id = NULL` and `ebay_payout_transactions.qbo_purchase_id = NULL` for that payout.
3. Re-run sync. Each Purchase should land at exact source gross under QBO's own per-line recompute, and the Deposit should construct to **£222.06** to the penny.

## Files touched

- New: `supabase/functions/_shared/qbo-tax.ts` — the QBO-stable distribution algorithm and pre-flight asserter.
- Modified: `supabase/functions/qbo-sync-payout/index.ts` — `createQBOPurchase` uses the new helper, drops `TxnTaxDetail.TotalTax`.
- Modified: `supabase/functions/qbo-sync-sales-receipt/index.ts` — same treatment.
- Modified (defence in depth, no behaviour change today): `supabase/functions/qbo-sync-refund-receipt/index.ts`, `qbo-retry-sync/index.ts`, `ebay-process-order/index.ts` — adopt the helper.

No DB migration. No schema change. No new secrets.

## Open question for confirmation before implementing

The rounding line: prefer (a) reuse `selling_fees` account with a zero-rated `TaxCodeRef` on that one line, or (b) add a new `qbo_account_mapping.purpose = "rounding_adjustment"` so it's auditable as its own line in QBO reports? Default plan is (a) for minimal moving parts.

