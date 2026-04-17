

## Root cause (proven, not guessed)

For payout `7388684270`, exactly one sale is wrong:

- Order `24-14326-19004` / `KO-0009323`
- eBay recorded the customer paid **£15.99** (`ebay_payout_transactions.gross_amount = 15.99`)
- App `sales_order.gross_total` = **£14.99** (`unit_price = 12.49 × 1 + 20% VAT`)
- QBO SalesReceipt `1668` TotalAmt = **£14.99** (built from the wrong app order)

All other 9 sales match eBay's recorded gross to the penny. Sum-of-deposit-lines = £221.06. Payout net = £222.06. The £1.00 "settlement adjustment" is the system masking a **single corrupted historical order record**, not arithmetic drift.

The app's design rule (your stated rule, restated) is that the channel's recorded sale amount IS canonical for a historical sale. Order `KO-0009323`'s `sales_order` row was mutated after the fact (current price replaced the original sale price). That breaks the rule and breaks every downstream record.

## What I will change

### 1. `qbo-sync-payout/index.ts` — detect and auto-rebuild on sale drift

Before linking a SalesReceipt into the deposit, for every SALE transaction:

- Read the canonical channel-recorded sale gross: `ebay_payout_transactions.gross_amount` for that transaction.
- Read the QBO SalesReceipt's `TotalAmt` via `fetchQBODocTotal`.
- If they differ by even 1p:
  1. Detect that `sales_order.gross_total` ≠ channel-recorded gross. If so, **repair the app order first**:
     - Recompute `sales_order_line.unit_price` and `line_total` so the order's gross equals the channel-recorded gross exactly. For single-line orders this is `unit_price = round(channelGross / 1.2 / qty, 2)` with the residual penny absorbed on the line so `line_total × 1.2` round-trips to `channelGross` exactly.
     - Update `sales_order.gross_total` to the channel-recorded gross.
     - Write a `price_audit_log` entry (`reason: 'payout_canonical_repair'`) so the change is auditable.
  2. Delete the stale QBO SalesReceipt (`deleteQBOSalesReceipt`).
  3. Clear `sales_order.qbo_sales_receipt_id` and `qbo_sync_status`.
  4. Invoke `qbo-sync-sales-receipt` for that order. The existing 3-attempt rounding-stable loop guarantees QBO's TotalAmt lands at exactly the canonical gross.
  5. Re-fetch the new SalesReceipt's TotalAmt and assert it equals the channel-recorded gross. If still wrong, mark payout `error` and surface the exact order — **no silent adjustment**.

### 2. Remove the £1 fudge

Delete the entire "Payout settlement adjustment" / `payoutAdjustmentAmount` block (lines 1111–1157 + 1234–1238). Remove the `payout_adjustment` account fallback path. After step 1, `sum(deposit lines) === payout.net_amount` to the penny by construction.

Add a final pre-POST assertion:
```
if (constructedPence !== expectedPence) {
  // Hard error with a per-order breakdown — never auto-mask.
  persistSyncFailure + return 422
}
```

### 3. Same canonical check for expense (`Purchase`) lines

For each expense-side payout transaction, the QBO Purchase `TotalAmt` must equal `Math.abs(gross_amount)` to the penny. The cached-purchase path at line 821–827 already enforces this. Extend the same enforcement to freshly-created Purchases by reading back the actual `TotalAmt` and asserting equality before adding the deposit line — no estimation, no rounding tolerance.

### 4. Post-POST deposit verification

After creating (or finding) the QBO Deposit, fetch its `TotalAmt` via the query endpoint and assert `toPence(qboDepositTotal) === toPence(payout.net_amount)`. If not, mark `error` (not `synced`, not `partial`) with the exact pence delta. Do not trust QBO's response without a read-back.

### 5. Repair the existing broken state

For payout `060ee447-…`:
- Delete QBO Deposit `2229` and QBO SalesReceipt `1668`.
- Restore `sales_order` `KO-0009323` to its canonical sale gross of **£15.99** (`unit_price = 13.33`, `line_total = 13.33`, `gross_total = 15.99`), with an audit log entry.
- Clear `qbo_sales_receipt_id` on that order and `qbo_deposit_id` + `qbo_sync_status` on the payout.
- Re-run the payout sync with the fixed code.

Expected result: deposit lands at **exactly £222.06**, no adjustment line, status `synced`.

### 6. Investigate the upstream corruption (separate follow-up, not in this fix)

`KO-0009323`'s sale was mutated from £15.99 to £14.99 after the fact. The `v2_cascade_sku_price_to_listings` trigger only writes to `channel_listing` and `price_audit_log`, not `sales_order_line`, so the corruption came from somewhere else (manual edit, an order re-import, a cart re-pricing path, etc.). I will note this as a follow-up — the fix above prevents it from quietly re-corrupting QBO, and the new audit-log entry will help track future occurrences. Recommend you raise a separate ticket to find and close that hole.

## Files

- `supabase/functions/qbo-sync-payout/index.ts` — canonical-drift detection + auto-rebuild loop, remove £1 adjustment block, deposit read-back assertion.
- `src/components/admin-v2/PayoutDetail.tsx` — replace "Partial / adjustment" copy with a per-order canonical-mismatch report when `error` status is set; otherwise unchanged.
- One-off SQL migration (data repair) — restore `KO-0009323` and clear sync IDs for the stuck payout.

No schema change.

