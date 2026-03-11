

## Fix: Duplicate Orders from eBay + QBO Double-Import

### Problem

There are 86 duplicate order pairs. Each pair has the same underlying sale imported twice:
1. **eBay sync** creates an order with `origin_channel = 'ebay'`, `origin_reference = '15-14333-73419'` (the eBay order ID)
2. **QBO sync** creates another order with `origin_channel = 'qbo'`, `origin_reference = '1734'` (the QBO internal ID), but with `doc_number = '15-14333-73419'`

The dedup check in `processSalesReceipt` (line 257-264) only matches on `(origin_channel, origin_reference)`, so it never detects the eBay-originated duplicate.

### Fix

Two changes needed:

**1. `supabase/functions/qbo-sync-sales/index.ts`** — Add a cross-channel dedup check before inserting a new sales order. After the existing `origin_reference` check passes, add a second check: if the receipt's `DocNumber` matches an existing order's `origin_reference` where `origin_channel = 'ebay'`, skip creation and instead backfill the QBO metadata (`origin_reference`, `doc_number`, `customer_id`, etc.) onto the existing eBay order via an update. This way the eBay order becomes the single record of truth, enriched with QBO data.

```text
Existing flow:
  Check (origin_channel=qbo, origin_reference=qboId) → skip if exists
  Insert new sales_order

New flow:
  Check (origin_channel=qbo, origin_reference=qboId) → skip if exists
  Check (origin_channel=ebay, origin_reference=docNumber) → if exists:
    - Update that eBay order with QBO fields (customer_id, tax details, vat backfill)
    - Mark landing as committed
    - Return created: false (enriched, not duplicated)
  Insert new sales_order (only for non-eBay QBO sales)
```

**2. Database cleanup migration** — Remove the 86 existing QBO duplicates:
- Delete `sales_order_line` rows for the QBO-duplicate orders
- Reopen any `stock_unit` records that were incorrectly closed by the duplicate's FIFO depletion
- Delete the QBO-duplicate `sales_order` rows
- Backfill QBO metadata (customer_id, global_tax_calculation) onto the surviving eBay orders

### Files changed

| File | Change |
|------|--------|
| `supabase/functions/qbo-sync-sales/index.ts` | Add cross-channel dedup check using DocNumber against eBay orders (~15 lines) |
| Database migration | Clean up 86 existing duplicates, reopen wrongly-closed stock, backfill QBO data |

