

# Fix: Insertion Fee Allocation + Subscription/Transfer Handling

## Problem Summary

1. **Insertion fees** (memo = "Insertion Fee", e.g. £0.12) are currently treated as account-level charges posted to the subscription account. They should be allocated as selling fees (COGS) against the specific listing/product they relate to.

2. **Subscription fees** (memo = date range, e.g. £32.40) appear as NON_SALE_CHARGE deductions paired with an equal TRANSFER_FROM credit. Currently TRANSFERs are excluded entirely, and NON_SALE_CHARGE expenses are excluded from the deposit. The subscription expense + transfer credit need to be included on the deposit so QBO balances correctly.

## Data Available

- eBay Finances API provides a `references` array on NON_SALE_CHARGE transactions containing `{ referenceId: "<item_id>", referenceType: "item_id" }` — this is the eBay listing item ID
- Our `channel_listing` table has `external_listing_id` which matches this item ID
- From `channel_listing` we can resolve to `sku_id` and then to the product

## Changes

### 1. Capture `references` from eBay API during import

**File**: `supabase/functions/_shared/ebay-finances.ts`
- Add `references?: Array<{ referenceId?: string; referenceType?: string }>` to the `EbayTransaction` interface

**File**: `supabase/functions/ebay-import-payouts/index.ts`
- When building transaction records, extract the `references` array and store the item ID reference in a new field or in `fee_details` for NON_SALE_CHARGE transactions
- For NON_SALE_CHARGE with memo "Insertion Fee", attempt to match `referenceId` against `channel_listing.external_listing_id` to resolve `sku_id` and the associated product. If matched, store the matched listing/SKU info on the transaction record (e.g. in `fee_details` or a new column)

### 2. Split NON_SALE_CHARGE handling: Insertion vs Subscription

**File**: `supabase/functions/qbo-sync-payout/index.ts`

Currently all NON_SALE_CHARGE transactions are posted to the `subscription_fees` account and excluded from the deposit. Change to:

- **Insertion fees** (memo contains "Insertion Fee"): Post to `selling_fees` account instead of `subscription_fees`. If a listing match was found, include the product/SKU reference in the expense description and attach CustomerRef if the listing has been sold. Include on the deposit as a deduction (same as SALE fees).
- **Subscription fees** (memo is a date range): Keep posting to `subscription_fees` account. Include on the deposit as a deduction (remove the NON_SALE_CHARGE exclusion at line 677, or make it conditional).

### 3. Include TRANSFER_FROM transactions

**File**: `supabase/functions/qbo-sync-payout/index.ts`

- Remove the `.neq("transaction_type", "TRANSFER")` filter at line 330
- For TRANSFER_FROM transactions: Add a positive deposit line representing eBay moving funds into the payout. This uses the `undeposited_funds` account as the source.
- Skip creating QBO Purchase expenses for TRANSFER transactions (they're not expenses — they're fund movements)

This ensures the deposit math works: `Sales - Fees - Insertion Fees - Subscription + Transfer = Net Payout`

### 4. Database: Add reference data column (optional but recommended)

**Migration**: Add `ebay_item_id` column to `ebay_payout_transactions` to store the resolved item reference from the eBay `references` array. This makes it queryable without parsing `fee_details`.

```sql
ALTER TABLE ebay_payout_transactions ADD COLUMN IF NOT EXISTS ebay_item_id text;
```

## Scope

- `supabase/functions/_shared/ebay-finances.ts` — add `references` to interface
- `supabase/functions/ebay-import-payouts/index.ts` — capture references, resolve listing match for insertion fees
- `supabase/functions/qbo-sync-payout/index.ts` — split insertion vs subscription handling, include TRANSFER_FROM
- Migration: add `ebay_item_id` column to `ebay_payout_transactions`
- Redeploy: `ebay-import-payouts`, `qbo-sync-payout`

## Post-fix

Re-import affected payouts to capture the `references` data from eBay (the current records don't have it). Then re-sync to QBO.

