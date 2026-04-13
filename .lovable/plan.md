

# Fix Payout Expenses Account + Include Expenses in Deposit

## Problems

1. **Expenses created against wrong account** — The `createQBOPurchase` call on line 533 uses `bankAccountRef: buildAccountRef(payoutBankRef)` (the bank/current account). Since eBay deducts fees at source before paying out, these expenses should be posted against **Undeposited Funds** — the same account the SalesReceipt credits. This way the deposit correctly sweeps the net amount.

2. **Deposit only includes SalesReceipt lines** — The deposit (lines 567-594) only adds lines for SALE transactions linked to SalesReceipts. The expenses (Purchases) created in step 5 must also appear as deposit lines so the deposit reconciles the full payout (gross sales minus fees = net transfer).

## Changes — `supabase/functions/qbo-sync-payout/index.ts` only

### 1. Change expense account from bank to Undeposited Funds

Line 533: change `bankAccountRef: buildAccountRef(payoutBankRef)` to `bankAccountRef: buildAccountRef(undepositedFundsAccount)`.

This posts the Purchase against Undeposited Funds, matching how eBay deducts fees before the payout reaches the bank.

### 2. Add expense (Purchase) lines to the deposit

After building the SalesReceipt deposit lines (lines 567-594), add a deposit line for each created Purchase. Each expense line:
- `Amount`: negative (fee deducted from payout)
- `DetailType`: `"DepositLineDetail"`
- `DepositLineDetail.AccountRef`: the selling_fees or subscription_fees account used for that expense
- `LinkedTxn`: `[{ TxnId: qboPurchaseId, TxnType: "Purchase" }]`

This requires tracking which account was used per expense. Update `expenseResults` to also store the account ref and amount, then build deposit lines from it.

### 3. Updated expenseResults structure

```typescript
const expenseResults: {
  txId: string;
  qboPurchaseId: string;
  amount: number;           // total gross of the expense
  accountRef: { value: string; name?: string };
}[] = [];
```

Populate amount and accountRef when recording each successful Purchase creation.

### 4. Deposit line generation

```typescript
// SalesReceipt lines (existing)
for (const entry of orderQboMap.values()) {
  depositLines.push({ Amount: entry.gross, ... LinkedTxn SalesReceipt });
}

// Expense (Purchase) lines — negative amounts net off the deposit
for (const exp of expenseResults) {
  if (exp.qboPurchaseId === "N/A") continue;
  depositLines.push({
    Amount: -exp.amount,
    DetailType: "DepositLineDetail",
    DepositLineDetail: { AccountRef: exp.accountRef },
    LinkedTxn: [{ TxnId: exp.qboPurchaseId, TxnType: "Purchase" }],
  });
}
```

The deposit total will equal gross sales minus expenses = net payout transferred to bank.

## No database or UI changes needed.

