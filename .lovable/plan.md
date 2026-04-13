

# Pre-flight QBO Validation for Payout Sync

## Problem
The `qbo-sync-payout` edge function currently creates a QBO Deposit without verifying that the linked sales orders (SalesReceipts) and fee expenses already exist in QBO. If they don't, the deposit references undeposited funds that haven't been posted, creating an accounting mismatch.

## Solution
Add a pre-flight check in the edge function that validates all linked sales orders have been synced to QBO before proceeding. Also surface this readiness status in the UI so the admin can see what's blocking the sync.

## Changes

### 1. `supabase/functions/qbo-sync-payout/index.ts`

Add a new step between fetching the payout (step 1) and resolving account mappings (step 2):

**Pre-flight: Verify linked orders are synced to QBO**
- Query `payout_orders` joined to `sales_order` for the current payout
- Check that every linked `sales_order` has a non-null `qbo_sales_receipt_id`
- If any are missing, collect the unsynced order references and return a `422` error with a clear message listing which orders need to be synced first (e.g. "Cannot create deposit: 2 linked orders not yet synced to QBO: ORD-123, ORD-456")
- Persist this as a `qbo_sync_error` on the payout so it's visible in the UI

### 2. `src/hooks/admin/use-payouts.ts`

Add a new hook `usePayoutQBOReadiness(payoutId)`:
- Query `payout_orders` joined to `sales_order` for the payout
- Return `{ ready: boolean, total: number, synced: number, unsyncedOrders: { id, reference, qboStatus }[] }`
- This lets the UI show sync readiness without attempting the actual sync

### 3. `src/components/admin-v2/PayoutDetail.tsx`

**QBO Sync Readiness section** (above the existing sync button):
- Show a readiness indicator: "3/3 orders synced to QBO" (green) or "1/3 orders synced" (amber)
- List any unsynced orders with links to their detail pages
- Disable the "Sync to QBO" button when not all orders are synced, with a tooltip explaining why
- When all orders are synced, enable the button as normal

### 4. Deposit payload improvement (in edge function)

Instead of a single lump-sum deposit line from Undeposited Funds, build one deposit line per linked SalesReceipt — this is the correct QBO pattern for matching deposits to individual sales:

```text
Current:  1 line → Amount: netAmount, Account: Undeposited Funds
Improved: N lines → one per linked SalesReceipt, each referencing the SalesReceipt entity
```

Each line will use `LinkedTxn` to reference the QBO SalesReceipt ID, which properly clears each receipt from Undeposited Funds in QBO.

## Technical Details

**Pre-flight query (edge function):**
```sql
SELECT so.id, so.origin_reference, so.qbo_sales_receipt_id, so.qbo_sync_status
FROM payout_orders po
JOIN sales_order so ON po.sales_order_id = so.id
WHERE po.payout_id = $payoutId
```

**Deposit line per SalesReceipt:**
```json
{
  "Amount": orderGross,
  "DetailType": "DepositLineDetail",
  "DepositLineDetail": {
    "AccountRef": { "value": "undepositedFundsId" }
  },
  "LinkedTxn": [{
    "TxnId": "qboSalesReceiptId",
    "TxnType": "SalesReceipt"
  }]
}
```

## No database changes needed
All required data (`payout_orders`, `sales_order.qbo_sales_receipt_id`) already exists.

