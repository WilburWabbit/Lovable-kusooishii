
Fix QBO Deposit Error 6000

What I verified
- I reviewed `supabase/functions/qbo-sync-payout/index.ts` and confirmed both requested bugs exist in step 6.
- The expense deposit loop currently:
  - sets `DepositLineDetail.AccountRef` to `exp.accountRef` (the expense category account)
  - adds `LinkedTxn: [{ TxnType: "Purchase" }]` on negative fee lines
- I also confirmed there is currently no guard for `depositLines.length === 0` before the Deposit POST.
- I reviewed the design docs and QBO specs; this is a surgical edge-function fix and does not require database or auth changes.

Implementation plan
1. Update the expense deposit loop in `supabase/functions/qbo-sync-payout/index.ts`
   - Keep the existing skip rules, including skipping `NON_SALE_CHARGE`.
   - Change negative fee deposit lines so they always clear from Undeposited Funds:
     - `DepositLineDetail.AccountRef: buildAccountRef(undepositedFundsAccount)`
   - Remove the `LinkedTxn` property entirely from those expense lines.

2. Add the empty-lines guard immediately after all deposit lines are built
   - Insert the exact 422 failure path you provided:
     - message: `Cannot create deposit: no deposit lines built — payout has no matched sales and no deductible expenses`
     - call `persistSyncFailure(admin, payoutId, msg)`
     - return the structured JSON error response with existing CORS/content-type headers.

3. Make no other changes
   - No changes to step 5 purchase creation
   - No changes to sales receipt-linked deposit lines
   - No changes to mappings, migrations, config, or other edge functions

4. Redeploy only the `qbo-sync-payout` edge function
   - This is required because edge-function source changes are not enough by themselves.

5. Validate the fix against the affected payout
   - Retry the sync for payout `78f4224e-6eca-426d-9315-77a8391500d0`
   - Confirm the deposit payload now has:
     - positive sales lines linked to `SalesReceipt`
     - negative fee lines using `undepositedFundsAccount`
     - no `LinkedTxn` on fee lines
   - Expected result: QBO returns a Deposit ID instead of error 6000.

Technical detail
The corrected expense line shape in step 6 will be:

```ts
depositLines.push({
  Amount: -exp.amount,
  DetailType: "DepositLineDetail",
  DepositLineDetail: {
    AccountRef: buildAccountRef(undepositedFundsAccount),
  },
});
```

Why this should resolve the error
- The current payload mixes the clearing logic incorrectly by using the expense category account on deposit deduction lines.
- It also attempts to link `Purchase` transactions in a way QBO Deposit does not support.
- This fix makes the deposit consistently clear all payout components through Undeposited Funds while leaving the separately-created Purchases as standalone expense records.

Files involved
- `supabase/functions/qbo-sync-payout/index.ts`

Deployment impact
- No migration needed
- No frontend change needed
- Single function redeploy only
