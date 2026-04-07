

# Fix: Sales Orders Missing Line Items and Stock Allocation

## Problem

QBO sales receipt 1796 (eBay order `14-14455-15040`) exists in the database with `qbo_sync_status = synced` but has **zero line items** and **no stock allocated**. There are **23 orders** with this same problem.

**Root cause**: The `processSalesReceipts` function in `qbo-process-pending` has a "match-first" path (lines 874–913) that checks if an order already exists by `origin_reference`, `doc_number`, or `order_number`. When it finds a match, it enriches the order with QBO fields (`qbo_sales_receipt_id`, `qbo_sync_status`) and commits the landing record — but **never creates line items or allocates stock**.

This happens when orders are created by eBay import (or another channel) as shell records without line items, then the QBO sales receipt comes through and the matcher assumes the order is already complete.

## Fix

Modify the match-first path in `processSalesReceipts` so that when it finds an existing order, it checks whether line items exist. If the order has no line items, it should proceed to create them from the QBO receipt data and allocate stock — the same logic already used for new orders (lines 986–1037).

### Changes

**File: `supabase/functions/qbo-process-pending/index.ts`**

In the three match-first branches (lines 880–913), after finding an existing order:
1. Check `SELECT COUNT(*) FROM sales_order_line WHERE sales_order_id = matched_order.id`
2. If count is 0, fall through to the line-item creation and stock allocation logic instead of continuing
3. If count > 0, keep the current enrich-and-skip behavior

This is a single logical change in one file. The line-item creation loop (lines 986–1037) already handles SKU resolution, stock allocation via `allocate_stock_units`, and individual line inserts — it just needs to be reachable when the order exists but is incomplete.

### Technical detail

The three match branches all follow the same pattern:
```
if (byRef) {
  // enrich with QBO fields
  // ← ADD: check line count, if 0 set order = byRef and fall through
  // instead of continue
}
```

A helper variable (e.g., `matchedOrderId`) can be set when a match is found with zero lines, allowing the code to skip the order INSERT but still execute the line-item loop.

### Deployment

- Redeploy `qbo-process-pending`
- Reset the 23 affected landing records back to `pending` so they reprocess
- Run "Process Pending" (sales) to backfill line items and allocate stock

### Expected outcome

- Receipt 1796 reprocesses → 4 line items created for `40220-1.1` → 4 of the 5 available units allocated
- All 23 affected orders get their line items and stock allocation
- No new orders created (existing ones are enriched in place)

