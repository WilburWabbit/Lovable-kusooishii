

# Payout QBO Sync: Transaction-Level Expense Creation + Readiness Fix

## What changes

The payout sync must ensure every non-TRANSFER transaction from the eBay payout exists in QBO before creating the deposit. There are two categories:

1. **Sale-related transactions** (SALE, SHIPPING_LABEL with an `order_id`) — the associated SalesReceipt must exist in QBO, and the fees/expenses must be created as QBO Purchases linked to the sale
2. **Non-sale charges** (NON_SALE_CHARGE with no `order_id`) — created as a QBO Purchase (expense) with eBay as the vendor, categorized as subscription expense

The TRANSFER line is excluded — it represents the payout transfer itself.

The readiness check (hook + edge function) switches from the stale `payout_orders` table to `ebay_payout_transactions` as the source of truth.

## Data reality (payout 7438552070)

| Type | Order ID | Gross | Fees | Action |
|------|----------|-------|------|--------|
| SALE | 14-14455-15038 | £15.99 | £2.64 | Verify SalesReceipt exists; create expense for fees |
| SHIPPING_LABEL | 14-14455-15038 | £3.01 | £0 | Create expense linked to sale |
| NON_SALE_CHARGE | (none) | £32.40 | £0 | Create subscription expense, eBay vendor |
| TRANSFER | (none) | £32.40 | £0 | Skip — this is the payout itself |

QBO eBay vendor ref: `{value: "4", name: "eBay"}`

## Files to change

### 1. `supabase/functions/qbo-sync-payout/index.ts` — Rewrite pre-flight + expense creation

**Pre-flight (replace payout_orders query):**
- Query `ebay_payout_transactions` where `payout_id = externalPayoutId` and `transaction_type != 'TRANSFER'`
- For each SALE transaction: verify the matched `sales_order` has a `qbo_sales_receipt_id`
- If any SALE orders are unsynced, return 422 with details

**Per-transaction expense creation (replace the single lump-sum expense):**
- For each non-TRANSFER transaction, create a QBO Purchase:
  - **SALE transactions**: One expense per SALE with fee_details as line items, account = `selling_fees`, vendor = eBay, CustomerRef linked to the sale's customer if available
  - **SHIPPING_LABEL**: Expense with amount as line, account = `selling_fees` (or a shipping-specific mapping if configured), vendor = eBay
  - **NON_SALE_CHARGE**: Expense with amount as line, account = `subscription_fees` (new mapping, falls back to `selling_fees`), vendor = eBay, memo from transaction
- Store created QBO Purchase IDs back on `ebay_payout_transactions` via `qbo_purchase_id` or track in `payout_fee` records
- All expenses must succeed before the deposit is created

**Deposit creation:**
- Build deposit lines from SALE transactions only (one per matched SalesReceipt, using gross_amount)
- Keep existing bank account validation and LinkedTxn pattern

**New account mapping needed:** `subscription_fees` (optional — falls back to `selling_fees` if not configured). Also need `ebay_vendor_id` mapping or hardcode vendor ref `{value: "4", name: "eBay"}` based on existing QBO data.

### 2. `src/hooks/admin/use-payouts.ts` — Rewrite `usePayoutQBOReadiness`

Switch data source from `payout_orders` to `ebay_payout_transactions`:
- Accept `externalPayoutId` instead of (or in addition to) internal `payoutId`
- Query `ebay_payout_transactions` where `payout_id = externalPayoutId` and `transaction_type != 'TRANSFER'`
- For SALE rows: join to `sales_order` via `matched_order_id` to check `qbo_sales_receipt_id`
- For non-SALE rows: check if expense already exists (e.g., `qbo_sales_receipt_id` on the transaction row, or a future `qbo_purchase_id` field)

**Updated return type:**
```typescript
interface PayoutQBOReadiness {
  ready: boolean;
  // Sales
  totalOrders: number;
  syncedOrders: number;
  unsyncedOrders: { id: string; reference: string | null; qboStatus: string | null }[];
  // Expenses
  totalExpenses: number;     // non-TRANSFER, non-SALE count
  createdExpenses: number;
  pendingExpenses: { transactionId: string; type: string; amount: number }[];
}
```

`ready = syncedOrders === totalOrders` (all sales in QBO). Expense status is informational — they get created during sync.

### 3. `src/components/admin-v2/PayoutDetail.tsx` — Update readiness display

- Pass `externalPayoutId` to the readiness hook
- Show order readiness: "1/1 orders synced" (not "9/9")
- Show expense readiness: "2 expenses pending creation" or "All expenses created"
- Keep disabled-button logic based on `ready`

### 4. Database migration — Add `qbo_purchase_id` to `ebay_payout_transactions`

Add a nullable text column to track the QBO Purchase ID created for each transaction's expense:
```sql
ALTER TABLE ebay_payout_transactions ADD COLUMN qbo_purchase_id text;
```

Also add `qbo_account_mapping` rows for `subscription_fees` and `ebay_vendor_id` if not present (or document that they fall back to `selling_fees` / hardcoded vendor 4).

## Sequence of operations in the edge function

1. Fetch payout record
2. Fetch all `ebay_payout_transactions` for this payout (exclude TRANSFER)
3. **Pre-flight**: Verify all SALE transactions have matched orders with `qbo_sales_receipt_id`
4. Get QBO token + account mappings
5. **Create expenses** for each non-TRANSFER transaction that doesn't already have a `qbo_purchase_id`:
   - SALE: fees as expense lines, eBay vendor, link to order
   - SHIPPING_LABEL: shipping cost as expense, eBay vendor
   - NON_SALE_CHARGE: subscription expense, eBay vendor
6. **Create deposit** with one line per SALE (LinkedTxn to SalesReceipt)
7. Update payout record with deposit ID and sync status

