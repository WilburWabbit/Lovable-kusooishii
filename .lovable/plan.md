

## Root cause (verified by reading all three writers + both readers)

`sales_order_line.unit_price` is written as **NET / ex-VAT** by every ingestion path:
- `ebay-process-order/index.ts` line 950: `unit_price: pl.unitPrice // NET per unit`
- `stripe-webhook/index.ts` line 726: `unit_price: pl.netUnitPrice`
- `qbo-process-pending/index.ts` line 1101: net unit price

But two consumers read it inconsistently:

1. `qbo-sync-sales-receipt/index.ts` line 109–110 builds `sourceLines.gross = unit_price * qty` — treats NET as GROSS. That means it then feeds NET pence into `buildBalancedQBOLines`, posts it as `UnitPrice` (still net) with 20% TaxExcluded — and QBO's recomputed `TotalAmt = net + 20% VAT` ends up at roughly the gross/1.2 of what was intended (i.e. £15.99 → built as if gross=£13.33 → QBO returns £13.33). This is exactly what happened to KO-0009323.
2. `qbo-sync-payout/index.ts` line 328–329 `repairSalesOrderToCanonicalGross` computes `lineGrossPence = round2(unit_price * qty * 1.2)` — treats NET as NET, which is correct in principle, but then iterates `unit_price` in 0.0001 increments looking for `round2(net * 1.2) === channelGross`. For some 2dp gross values (e.g. £15.99) no rational net at any precision satisfies that equation under banker rounding, so the loop fails after 20 000 steps.

Both bugs cancel partially when the data is already correct, which is why most sales sync fine. They only manifest when a repair is needed.

## Fix — minimal, two files, no other changes

### File 1: `supabase/functions/qbo-sync-sales-receipt/index.ts`

Change exactly line 109–110 (the `sourceLines` construction) so it correctly converts the stored NET line into GROSS pence before feeding the existing balancer:

```ts
const sourceLines = (lineItems ?? []).map((li) => {
  const qty = (li.quantity as number) ?? 1;
  const netLineTotal =
    typeof li.line_total === "number" ? li.line_total : ((li.unit_price as number) ?? 0) * qty;
  // unit_price/line_total are stored ex-VAT. Convert to GROSS pence here so
  // the existing per-line balancer + QBO ex-VAT posting (UnitPrice = net,
  // TaxCodeRef = 20%) lands on the correct customer-facing total.
  const grossPence = Math.round(netLineTotal * VAT_DIVISOR * 100);
  return {
    gross: grossPence / 100,
    qty,
    sku: li.sku as Record<string, unknown> | null,
  };
});
```

Everything downstream (`buildBalancedQBOLines`, ex-VAT posting, 3-attempt convergence loop, `assertQBOTotalMatches`) is already correct and stays untouched. The `GlobalTaxCalculation: "TaxExcluded"` posting model is preserved.

### File 2: `supabase/functions/qbo-sync-payout/index.ts` — replace `repairSalesOrderToCanonicalGross` (lines 304–440)

Replace the iterative 0.0001-step search with deterministic integer-pence math against the **correct** invariant:

- canonical gross pence = `toPence(channelGross)`
- canonical net pence  = `round(channelGrossPence / 1.2)` (banker)
- canonical VAT pence  = `channelGrossPence - canonical net pence`
- distribute net pence across lines proportionally to current line value, **residual penny on the largest line**, using `distributeLinesByGrossPence` from the shared `vat.ts` (already imported)
- write each line's `unit_price = newNetLineTotal / qty` at full precision (round to 4dp only for display; QBO sync now derives gross from net correctly)
- write `sales_order.gross_total = channelGross` exactly
- write `price_audit_log` entry per changed SKU (reason `payout_canonical_repair`)

No iteration. No convergence loop. No 4dp gymnastics needed for QBO — QBO receives the net, applies 20%, returns the canonical gross to the penny because we're now operating in the same arithmetic space the rest of the app uses.

After repair the function continues exactly as today: delete stale SalesReceipt → invoke `qbo-sync-sales-receipt` (now reading net correctly) → re-verify `TotalAmt === channelGross` → proceed with deposit.

## Explicitly NOT changed

- Ex-VAT QBO posting model (`GlobalTaxCalculation: "TaxExcluded"`, `UnitPrice = net`, `TaxCodeRef` 20%) — kept.
- `qbo-sync-sales-receipt` 3-attempt rounding-stable loop — kept.
- `qbo-sync-payout` deposit construction, pre-POST balance assertion, post-POST `TotalAmt` verification — kept.
- Purchase / expense path — kept (purchases store gross differently and that path is not affected by this bug; the existing detect-mismatch → delete → recreate loop already works for them).
- `vat.ts`, `qbo-tax.ts`, `_shared/pricing.ts` — untouched.
- No schema change. No migration. No UI change.

## Re-running the stuck payout

After the two-file fix:
1. Re-trigger `qbo-sync-payout` for `060ee447-…`.
2. Detector sees KO-0009323 QBO TotalAmt £13.33 ≠ canonical £15.99.
3. Repair sets `sales_order_line.unit_price = 13.325`, `line_total = 13.325`, `sales_order.gross_total = 15.99`. Audit logged.
4. Stale SalesReceipt deleted.
5. `qbo-sync-sales-receipt` re-invoked: reads net 13.325, converts to gross pence 1599, balancer produces lines summing to 1599 gross, posts ex-VAT, QBO returns `TotalAmt = 15.99`. Verified.
6. Deposit built and posted at exactly £222.06. Status `synced`.

## Files

- `supabase/functions/qbo-sync-sales-receipt/index.ts` — replace `sourceLines` mapping (≈4 lines).
- `supabase/functions/qbo-sync-payout/index.ts` — replace body of `repairSalesOrderToCanonicalGross` with integer-pence net repair.

