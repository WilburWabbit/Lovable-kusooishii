
## Root cause

The new safeguard is correctly catching a real bug — QBO is returning totals **20% higher** than what we send. £2.64 → £3.17, £9.93 → £11.92, £32.40 → £38.88. That's 1.20× exactly.

Looking at the payload in the logs:

```json
{
  "GlobalTaxCalculation": "TaxInclusive",
  "Line": [{
    "Amount": 2.09,
    "AccountBasedExpenseLineDetail": {
      "TaxCodeRef": { "value": "6" },
      "TaxAmount": 0.35,
      "TaxInclusiveAmt": 2.09,
      ...
    }
  }, ...]
}
```

The bug is in how `Amount` is being set when `GlobalTaxCalculation: "TaxInclusive"` is used.

**QBO's TaxInclusive contract:**
- `Amount` must be the **net** (ex-VAT) value
- `TaxInclusiveAmt` is the gross
- QBO computes `TotalAmt = sum(Amount) + sum(TaxAmount)` 

What we sent for the £2.64 Purchase: line `Amount: 2.09` + line `TaxAmount: 0.35` = £2.44 net+tax... but QBO returned £3.17. That means QBO is treating `Amount: 2.09` as net, then **adding 20% tax on top** = £2.51, plus the explicit `TaxAmount: 0.35` = ~£2.86... still doesn't reach £3.17.

Actually the math is simpler: **QBO is treating the per-line `Amount` field as the gross value (because TaxInclusive mode says so), and ALSO adding the explicit `TaxAmount` again**. So `2.09 + 0.07 + 0.48 = 2.64` (matches our expected) **plus** the three TaxAmounts `0.35 + 0.01 + 0.08 = 0.44` added a second time → wait that's £3.08, not £3.17.

Let me re-check. £2.64 × 1.20 = £3.168 ≈ £3.17. £9.93 × 1.20 = £11.916 ≈ £11.92. £32.40 × 1.20 = £38.88 exact. So QBO is taking our gross `Amount` values and **adding 20% VAT on top**, ignoring `TaxInclusiveAmt`.

That happens when `GlobalTaxCalculation: "TaxInclusive"` is set but the line `Amount` is treated by QBO as net (its default interpretation). The combination of `Amount` (gross), `TaxInclusiveAmt` (gross), and explicit `TaxAmount` is contradictory and QBO is resolving it by treating `Amount` as net + applying TaxCodeRef VAT on top.

## The actual fix

QBO's `TaxInclusive` mode for AccountBasedExpenseLineDetail requires:
- `Amount` = **gross** (tax-inclusive) value ✓ (we do this)
- **Do NOT send explicit `TaxAmount`** — QBO derives it from `TaxCodeRef` and the gross `Amount`
- **Do NOT send `TaxInclusiveAmt`** — that's a SalesItemLineDetail field, not valid here
- `TaxCodeRef` tells QBO which rate to back-out

When you send all three (Amount + TaxAmount + TaxInclusiveAmt) under TaxInclusive mode, QBO's behaviour is undefined and it defaults to treating Amount as net.

### Change to `createQBOPurchase` in `supabase/functions/qbo-sync-payout/index.ts`

For each expense line:
- Keep `Amount` = gross pence/pounds
- Keep `TaxCodeRef` 
- **Remove `TaxAmount`**
- **Remove `TaxInclusiveAmt`**
- Keep `GlobalTaxCalculation: "TaxInclusive"` at document level
- Remove the document-level `TxnTaxDetail` if present (let QBO compute)

QBO will then:
1. Read `Amount` as gross
2. Use `TaxCodeRef` rate (20%) to derive net = Amount / 1.2 and tax = Amount - net
3. Set `TotalAmt` = sum of gross Amounts (exact match to source)

The new safeguard `assertQBOTotalMatches` will then pass because TotalAmt will equal the sum of our line gross values to the penny.

## Why this matches every error in the log

Every failing Purchase shows `expected × 1.20 ≈ returned`:
| Expected | Returned | Ratio |
|---|---|---|
| £2.64 | £3.17 | 1.2008 |
| £9.93 | £11.92 | 1.2004 |
| £32.40 | £38.88 | 1.2000 |
| £0.12 | £0.14 | 1.1667 (rounding noise on tiny amount) |
| £8.58 | £10.30 | 1.2005 |

Consistent 20% overshoot = QBO double-applying VAT.

## Files

- `supabase/functions/qbo-sync-payout/index.ts` — strip `TaxAmount` and `TaxInclusiveAmt` from `AccountBasedExpenseLineDetail` in `createQBOPurchase`. Keep `TaxCodeRef` and document-level `GlobalTaxCalculation: "TaxInclusive"`.

## Data repair

After deploy:
1. Delete QBO Purchases 2030–2051 manually in QBO (all 22 over-taxed records).
2. Clear `qbo_purchase_id` on the affected `ebay_payout_transactions` rows for payout `060ee447-02f7-4527-84a4-95aedecd0daa`.
3. Re-run the payout sync. Each Purchase should land at exact gross, the safeguard should pass, and the Deposit should construct to £222.06 exactly.

No DB migration needed.
