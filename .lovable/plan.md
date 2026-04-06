

# Fix Duplicate Purchases, Stale Customers, and Missing Payouts

## Root Causes Found

### 1. Duplicate Purchase Batches (PO-086 + PO-172 for same QBO 1748)
The rebuild deletes `inbound_receipt`, `stock_unit`, `sku`, etc. but **never deletes `purchase_batches` or `purchase_line_items`**. There are 173 batch rows for 87 distinct QBO references — every purchase is duplicated exactly. The old batch rows from before the rebuild persist, and the Intake UI creates new ones when processing receipts.

### 2. Stale/Deleted Customers (QBO ID 493 still present)
Two bugs compound:
- `qbo-sync-customers` queries `SELECT * FROM Customer` with **no `Active = true` filter**, so inactive/merged customers are landed
- `processCustomers` has no post-processing cleanup step to delete canonical customers that no longer have a matching landing record after a rebuild

### 3. Missing Payout/Deposit Data
No `qbo-sync-deposits` function exists. eBay payout landing table is empty (reset during rebuild, never repopulated). The rebuild's Phase 3 processes QBO records but never replays non-QBO landing events.

## Plan

### Step 1: Add `purchase_batches` and `purchase_line_items` to rebuild deletion

In `admin-data/index.ts`, add deletion of `purchase_line_items` (child first) then `purchase_batches` between the stock unit deletion and inbound receipt deletion steps.

### Step 2: Filter inactive customers during sync

In `qbo-sync-customers/index.ts`, change the query from `SELECT * FROM Customer` to `SELECT * FROM Customer WHERE Active = true` to prevent inactive/deleted customers from being landed.

### Step 3: Add customer orphan cleanup after processing

In `qbo-process-pending/index.ts`, after `processCustomers` finishes all pending records, add a cleanup step: query all `customer` rows where `qbo_customer_id IS NOT NULL`, then check each against `landing_raw_qbo_customer`. Delete any canonical customer whose QBO ID has no matching landing record (meaning it was deleted/deactivated in QBO).

### Step 4: Create QBO Deposit sync and landing

- **Migration**: Create `landing_raw_qbo_deposit` table (same structure as other landing tables)
- **New edge function**: `qbo-sync-deposits/index.ts` — queries `SELECT * FROM Deposit` from QBO and lands raw payloads
- **Processor addition**: Add `processDeposits` function in `qbo-process-pending` that reads deposit landing records and creates `payouts` rows, linking deposit lines to sales orders via their QBO SalesReceipt references

### Step 5: Add deposit sync to rebuild pipeline

In `QboSettingsCard.tsx`, add a Phase 2g step between sales sync and processing to sync deposits from QBO. Add `landing_raw_qbo_deposit` to the landing tables cleared during Phase 1 in `admin-data`.

## Files Modified

1. `supabase/functions/admin-data/index.ts` — delete `purchase_batches`/`purchase_line_items` in rebuild; clear `landing_raw_qbo_deposit`
2. `supabase/functions/qbo-sync-customers/index.ts` — filter `Active = true`
3. `supabase/functions/qbo-process-pending/index.ts` — customer orphan cleanup; `processDeposits` function
4. `supabase/functions/qbo-sync-deposits/index.ts` — new function
5. `src/components/admin-v2/QboSettingsCard.tsx` — add deposit sync phase
6. Database migration — create `landing_raw_qbo_deposit` table

