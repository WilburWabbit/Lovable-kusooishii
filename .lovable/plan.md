

## Sync QBO Sales Receipts & Refund Receipts

### Summary
Create a new edge function `qbo-sync-sales` that pulls QBO Sales Receipts and Refund Receipts, creates `sales_order` records, and for sales — matches and marks the oldest available `stock_unit` as sold (FIFO). Refund Receipts create sales_orders with negative totals for accounting only, no stock changes.

### QBO API Entities
- **SalesReceipt** — a completed sale (payment already received). Lines contain `SalesItemLineDetail` with `ItemRef`, `Qty`, `UnitPrice`.
- **RefundReceipt** — a refund issued. Same line structure as SalesReceipt.

### Changes

**1. New edge function: `supabase/functions/qbo-sync-sales/index.ts`**

Auth/token pattern identical to `qbo-sync-purchases`. Core logic:

- Query `SELECT * FROM SalesReceipt MAXRESULTS 1000` and `SELECT * FROM RefundReceipt MAXRESULTS 1000`
- Pre-fetch QBO items (reuse same item cache + batch pattern)
- For each SalesReceipt:
  - Parse lines → resolve SKU via `parseSku` on QBO item Sku field → find `sku` by `sku_code`
  - Upsert `sales_order` with `origin_channel = 'qbo'`, `origin_reference = SalesReceipt.Id`, `status = 'completed'`
  - Use unique constraint on `origin_reference` + `origin_channel` to skip already-synced
  - Create `sales_order_line` rows linked to the SKU
  - For each line qty, find the oldest `stock_unit` with matching `sku_id` and `status = 'available'`, update to `status = 'sold'`, link via `stock_unit_id` on the order line
  - If no available stock found, still create the order line but log a warning (don't block)
- For each RefundReceipt:
  - Create `sales_order` with `origin_channel = 'qbo_refund'`, `origin_reference = RefundReceipt.Id`, `status = 'completed'`, negative totals
  - Create `sales_order_line` rows (negative `line_total`) — no stock changes
- Skip already-processed orders (by `origin_reference`)
- Return summary counts

**2. Database migration**
- Add unique constraint on `sales_order(origin_channel, origin_reference)` to enable upsert and prevent duplicates
- Add `WHERE origin_reference IS NOT NULL` partial unique index since existing web orders have null `origin_reference`

**3. `supabase/config.toml`** — register `qbo-sync-sales` with `verify_jwt = false`

**4. `src/pages/admin/QboSettingsPanel.tsx`** — add a "Sync Sales" button next to "Sync Purchases", calling `qbo-sync-sales`

### Data Flow
```text
QBO SalesReceipt
  → sales_order (origin_channel='qbo', status='completed')
  → sales_order_line per item line
  → stock_unit (oldest available by sku_id) → status='sold'

QBO RefundReceipt
  → sales_order (origin_channel='qbo_refund', status='completed', negative totals)
  → sales_order_line (negative line_total)
  → no stock changes
```

### What stays the same
- Purchase sync unchanged
- Manual order creation unchanged
- Stock unit FIFO matching is scoped to sales sync only

