

## Root cause

Our deposit payload sums **exactly to £222.06**. The reconciliation guard logs `constructed=222.06, expected=222.06, delta=0` and the payload sent to QBO contains lines totalling £222.06 to the penny.

QBO is the one adding the extra £0.01 — it produces a Deposit of £222.07 from a payload of £222.06. The culprit is this field on the Deposit payload:

```json
"GlobalTaxCalculation": "TaxExcluded"
```

This was added recently to the SalesReceipt sync (correctly — sales receipts need it). But it was also propagated to the **Deposit** payload at line 874. Deposits are not tax documents:

- Their lines link to existing `SalesReceipt` and `Purchase` records that already carry their own gross/net.
- When `GlobalTaxCalculation: "TaxExcluded"` is set on a Deposit, QBO interprets each line `Amount` as net-of-tax and applies a tax adjustment to the linked transactions, producing rounding artefacts at the penny level.

The correct value for a Deposit linking to gross SalesReceipts and Purchases is `"NotApplicable"` (or simply omit the field — QBO defaults appropriately for Deposits).

## Fix

### Single change in `supabase/functions/qbo-sync-payout/index.ts` (line 874)

Remove the `GlobalTaxCalculation: "TaxExcluded"` line from the Deposit payload object. Deposits should not carry this field.

```diff
 const depositPayload: Record<string, unknown> = {
   TxnDate: payoutDate,
   DepositToAccountRef: buildAccountRef(payoutBankRef),
-  GlobalTaxCalculation: "TaxExcluded",
   Line: depositLines,
   PrivateNote: `${channel} payout ${externalPayoutId} — ${saleTxs.length} orders, ${expenseResults.length} expenses`,
 };
```

That's the entire change.

### Why this matches the symptom exactly

- Our payload sum: **£222.06** ✓ (verified in logs and recomputed from raw transaction data)
- QBO created: **£222.07**
- Delta: **+£0.01** — within the rounding noise produced by an unintended tax recalculation across 31 lines

No other code path touches the deposit total. The `Line[]` Amount values are already correct.

### Action required after deploy

1. Delete QBO Deposit **2028** (Ref £222.07) manually in QuickBooks Online.
2. Clear the `qbo_deposit_id` field for payout `060ee447-02f7-4527-84a4-95aedecd0daa`.
3. Re-run the sync — the new Deposit should be exactly £222.06.

### Files
- `supabase/functions/qbo-sync-payout/index.ts` — remove one line (874).

No DB migrations needed.

