

# Fix QBO Readiness: Match Orders by Reference + Include SALE Fees

## Problems

1. **Sales not identified** — The SALE transaction has `matched_order_id = null`, but the sales order exists with `origin_reference = '14-14455-15038'` and `qbo_sales_receipt_id = 1794`. The hook only checks `matched_order_id` and never falls back to matching via `order_id` against `sales_order.origin_reference`. Result: shows "0/1 orders synced (unmatched)" when it should be "1/1 synced".

2. **SALE fees missing from expenses** — The hook splits transactions into "sales" and "expenses" by filtering `transaction_type !== 'SALE'`. But SALE transactions have fees too (`total_fees = £2.64`) that need a QBO Purchase created. These are excluded from the expense count entirely.

## Changes

### 1. `src/hooks/admin/use-payouts.ts` — `usePayoutQBOReadiness`

**Fix order matching (fallback to `order_id` → `origin_reference`):**
- For SALE transactions where `matched_order_id` is null but `order_id` is present, query `sales_order` by `origin_reference` matching the transaction's `order_id`
- This finds the existing order (e393778f) and its `qbo_sales_receipt_id` (1794)

**Include SALE fees in expense count:**
- Change expense tracking to count ALL non-TRANSFER transactions that need a QBO Purchase
- SALE transactions with `total_fees > 0` need an expense for fees
- SHIPPING_LABEL transactions need an expense for the label cost
- NON_SALE_CHARGE transactions need a subscription expense
- Check `qbo_purchase_id` on each to determine if already created

**Updated return type** — add a combined count:
```typescript
totalExpenses: number;     // all non-TRANSFER txns needing a QBO Purchase
createdExpenses: number;   // those with qbo_purchase_id set
pendingExpenses: [...]     // those without, including SALE fee expenses
```

### 2. `src/components/admin-v2/PayoutDetail.tsx` — No structural changes needed
The UI already displays the readiness data correctly; it just renders wrong numbers because the hook returns wrong data.

### 3. `supabase/functions/qbo-sync-payout/index.ts` — Same fallback fix
Apply the same `order_id` → `origin_reference` fallback in the edge function's pre-flight check so it finds the existing SalesReceipt and doesn't block the sync.

## No database changes needed.

