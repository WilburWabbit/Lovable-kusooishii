

# Fix: Deposit Construction + Reset Buttons

## Root Cause (£188.67 vs £222.06)

The subscription fee NON_SALE_CHARGE (-£32.40) is included as a Purchase deduction on the deposit, but the offsetting TRANSFER_FROM (+£32.40) deposit line was not deployed when the sync ran. Result: 300.89 - 112.22 = 188.67 instead of 222.06.

Since the Purchase alone is sufficient for the subscription (it already records DR Subscription Fees / CR Undeposited Funds), neither the subscription Purchase nor the TRANSFER should appear on the QBO Deposit at all — they net to zero and are independent of the bank payout.

## Changes

### 1. Fix deposit line construction — `qbo-sync-payout/index.ts`

**Exclude NON_SALE_CHARGE and TRANSFER from the deposit entirely:**

- Remove the TRANSFER deposit lines block (lines 701-714)
- When building expense deposit lines (lines 686-699), skip expenses where the source transaction was `NON_SALE_CHARGE` — they are standalone Purchases paid from undeposited funds, not deductions from the payout

This means the deposit only contains: SalesReceipt lines (positive) + SALE/SHIPPING_LABEL fee Purchases (negative) = net payout amount.

**Track transaction type in expenseResults** to enable this filtering — the `transactionType` field already exists in the results array (line 647).

### 2. Add reset sync buttons — `PayoutDetail.tsx`

Add a "Reset Sync" section with three buttons:
- **Reset Expenses** — clears `qbo_purchase_id` on all `ebay_payout_transactions` for this payout
- **Reset Deposit** — clears `qbo_deposit_id` and sets `qbo_sync_status = 'pending'`
- **Reset All** — both operations

Styled as destructive outline buttons with confirmation toast.

### 3. Add reset mutation — `use-payouts.ts`

Add `useResetPayoutSync` mutation that calls `admin-data` with `{ action: "reset_payout_sync", payoutId, scope }`.

### 4. Add reset handler — `admin-data/index.ts`

Handle `reset_payout_sync` action:
- `scope: 'expenses'` — update `ebay_payout_transactions` set `qbo_purchase_id = null` where `payout_id = externalPayoutId`
- `scope: 'deposit'` — update `payouts` set `qbo_deposit_id = null, qbo_sync_status = 'pending'` where `external_payout_id = externalPayoutId`
- `scope: 'all'` — both

### 5. Redeploy

- `qbo-sync-payout`
- `admin-data`

## Scope

| File | Change |
|------|--------|
| `supabase/functions/qbo-sync-payout/index.ts` | Exclude NON_SALE_CHARGE + TRANSFER from deposit lines |
| `src/components/admin-v2/PayoutDetail.tsx` | Add reset sync buttons |
| `src/hooks/admin/use-payouts.ts` | Add `useResetPayoutSync` mutation |
| `supabase/functions/admin-data/index.ts` | Add `reset_payout_sync` handler |

## Post-fix

1. Delete QBO deposit 1859 manually
2. Use "Reset All" on the payout detail page
3. Re-sync — deposit should equal net payout (£222.06)

