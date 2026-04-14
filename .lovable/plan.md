

# Fix QBO Deposit Creation — Match Real Deposit Structure + Remove Lump-Sum Fallback

## Summary
Apply three structural fixes to the deposit payload in `qbo-sync-payout` based on analysis of real QBO deposits, and remove the lump-sum fallback (replacing it with an error) since all deposits should be transaction-backed.

## Changes — `supabase/functions/qbo-sync-payout/index.ts`

### 1. Fix SalesReceipt deposit lines (~line 582-594)
- Remove `AccountRef` from `DepositLineDetail`
- Add `PaymentMethodRef: { value: "1" }` instead
- Add `TxnLineId: "0"` to the `LinkedTxn` entry

### 2. Fix expense (Purchase) deposit lines (~line 617-624)
- Change `TxnType` from `"Payment"` back to `"Purchase"`
- Remove `AccountRef` from `DepositLineDetail`
- Add `PaymentMethodRef: { value: "1" }` instead
- Add `TxnLineId: "0"` to the `LinkedTxn` entry

### 3. Remove lump-sum fallback (~line 595-607)
Replace the `else if` fallback block with an error return:
```ts
} else {
  const msg = "Cannot create deposit: no SalesReceipt lines — all payout transactions must be linked to QBO records";
  await persistSyncFailure(admin, payoutId, msg);
  return new Response(
    JSON.stringify({ success: false, error: msg, payoutId, expensesCreated: expenseResults.length }),
    { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
}
```

### 4. Redeploy `qbo-sync-payout`

## No other changes
- No database migrations
- No frontend changes
- The empty-lines guard at line 628 remains as a secondary safety net

