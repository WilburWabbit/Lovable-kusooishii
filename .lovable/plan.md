

# Stock Unit Inventory Diagnostic — Findings

## 1. How `qty_on_hand` Works

**It is a computed value from a database view, NOT a stored column.**

The `v2_variant_stock_summary` view (defined in migration `20260322200002`) computes `qty_on_hand` as:

```sql
COUNT(su.id) FILTER (WHERE su.v2_status IN ('graded', 'listed')) AS qty_on_hand
```

The `sku` table has **no** `qty_on_hand` column. The admin UI (`use-products.ts`) reads from the `v2_variant_stock_summary` view to get stock counts. The public storefront uses the `product_detail_offers` function which counts `stock_unit` rows with `status = 'available'`.

The `v2_recalculate_variant_stats` function updates `avg_cost`, `floor_price`, and `cost_range` on the `sku` table — but **not** `qty_on_hand` (because it's on the view, not a stored column). This is correct by design.

**Conclusion**: `qty_on_hand` itself cannot be "phantom" — it's always a live count. If it's wrong, the underlying `stock_unit` rows have incorrect statuses.

---

## 2. Order → Stock Consumption Gaps

### Critical Finding: TWO PARALLEL STATUS SYSTEMS

The `stock_unit` table has **two** status columns:
- `status` (legacy): values like `available`, `closed`, `received`, `graded`
- `v2_status` (new): values like `purchased`, `graded`, `listed`, `sold`, `shipped`

**The `qty_on_hand` view counts `v2_status IN ('graded', 'listed')`** but the legacy order paths set `status = 'closed'` without touching `v2_status`.

### eBay Orders (`ebay-process-order`)

1. Creates `sales_order` + `sales_order_line` rows — **no `stock_unit_id` on the line items**
2. Legacy FIFO depletion (Step 9, line ~960): queries `status = 'available'`, sets `status = 'closed'` — **does NOT set `v2_status`**
3. Then calls `v2-process-order` as fire-and-forget — this function tries FIFO via `v2_consume_fifo_unit()` which queries `v2_status = 'listed'`

**GAP**: The legacy Step 9 sets `status = 'closed'` but leaves `v2_status` untouched. If `v2_status` was `'listed'`, it stays `'listed'`. So the view still counts the unit as on-hand. Then `v2-process-order` may or may not successfully re-consume via the v2 path (it requires `v2_status = 'listed'` which may still be true since Step 9 didn't change it, but it's a race condition).

### Website Orders (Stripe webhook)

1. Creates `sales_order` + `sales_order_line` rows — **does** set `stock_unit_id` on lines via FIFO (`status = 'available'`)
2. Sets `status = 'closed'` on consumed units — **does NOT set `v2_status`**
3. Then calls `v2-process-order` fire-and-forget — but since `stock_unit_id` is already set on lines, it skips them (idempotency guard: `if (line.stock_unit_id) continue`)

**GAP**: `v2_status` is never updated to `'sold'`. Units remain `v2_status = 'listed'` or `'graded'` → view counts them as on-hand.

### Cash Sales (CashSaleForm)

1. Calls `v2_consume_fifo_unit` which **does** set `v2_status = 'sold'` ✅
2. Also sets `order_id` and `sold_at` on the unit ✅
3. Does NOT call `v2-process-order` (not needed since it handles FIFO inline)

**This is the only path that correctly updates `v2_status`.** Cash sales work correctly.

### v2-process-order (post-order hook)

1. Calls `v2_consume_fifo_unit` (DB function) which sets `v2_status = 'sold'` and `sold_at = now()` ✅
2. Sets `order_id` on the unit ✅
3. But for Stripe orders, lines already have `stock_unit_id` set, so this function **skips all lines**

---

## 3. Stock-In Gaps

Stock units are created during purchase batch processing. The grading flow (`useGradeStockUnit`) correctly sets `v2_status` to `'graded'` or `'listed'`. No phantom stock creation path found — the issue is purely on the consumption side.

---

## 4. Integrity Queries

```sql
-- Query A: Variants where view qty_on_hand doesn't match reality
-- (This is a self-check — the view IS the count, so this validates the view logic)
SELECT sk.sku_code,
  COUNT(su.id) FILTER (WHERE su.v2_status IN ('graded', 'listed')) AS v2_on_hand,
  COUNT(su.id) FILTER (WHERE su.status = 'available') AS legacy_available,
  COUNT(su.id) FILTER (WHERE su.status = 'closed' AND su.v2_status IN ('graded', 'listed')) AS ghost_units
FROM sku sk
LEFT JOIN stock_unit su ON su.sku_id = sk.id
GROUP BY sk.sku_code
HAVING COUNT(su.id) FILTER (WHERE su.status = 'closed' AND su.v2_status IN ('graded', 'listed')) > 0
ORDER BY ghost_units DESC;

-- Query B: Stock units marked sold/shipped/closed but with no order link
SELECT id, uid, mpn, v2_status, status, order_id, sold_at
FROM stock_unit
WHERE v2_status IN ('sold', 'shipped', 'delivered', 'complete')
  AND order_id IS NULL
ORDER BY sold_at DESC NULLS LAST;

-- Query C: Units per purchase line vs expected quantity
SELECT pli.id AS line_item_id, pli.batch_id, pli.mpn, pli.quantity AS expected,
  COUNT(su.id) AS actual_units
FROM purchase_line_items pli
LEFT JOIN stock_unit su ON su.line_item_id = pli.id
GROUP BY pli.id, pli.batch_id, pli.mpn, pli.quantity
HAVING COUNT(su.id) != pli.quantity
ORDER BY pli.batch_id;

-- Query D: Order lines with no stock unit linked
SELECT sol.id, so.order_number, so.origin_channel, sk.sku_code,
  sol.stock_unit_id, sol.quantity
FROM sales_order_line sol
JOIN sales_order so ON so.id = sol.sales_order_id
LEFT JOIN sku sk ON sk.id = sol.sku_id
WHERE sol.stock_unit_id IS NULL
ORDER BY so.created_at DESC;

-- Query E: THE ROOT CAUSE QUERY — units where legacy status=closed
-- but v2_status still shows graded/listed (phantom stock)
SELECT su.id, su.uid, su.mpn, su.status, su.v2_status,
  sk.sku_code, su.order_id, su.sold_at
FROM stock_unit su
LEFT JOIN sku sk ON sk.id = su.sku_id
WHERE su.status = 'closed'
  AND su.v2_status IN ('graded', 'listed')
ORDER BY su.mpn, su.created_at;
```

---

## 5. QBO Sync Model

QBO calculates its own `QtyOnHand` from Purchases (stock-in) and SalesReceipts (stock-out). The app does **not** push `qty_on_hand` to QBO directly. Instead:
- `qbo-sync-purchases` creates Purchase transactions → QBO increments qty
- `qbo-sync-sales-receipt` creates SalesReceipts → QBO decrements qty

The divergence between app and QBO is a symptom: if the app's `v2_status` isn't being decremented on sale, but QBO SalesReceipts ARE being created (which they are — the QBO sync fires correctly), then QBO will show lower stock than the app.

---

## 6. Root Cause

**The dual status system (`status` vs `v2_status`) is the root cause.** The legacy order paths (Stripe webhook, eBay process-order Step 9) set `status = 'closed'` but never update `v2_status`. The `v2_variant_stock_summary` view counts by `v2_status`, so sold units remain counted as on-hand.

The `v2-process-order` function was designed to fix this gap, but:
- For **Stripe orders**: it skips all lines because `stock_unit_id` was already set by the webhook
- For **eBay orders**: there's a race condition with the legacy FIFO in Step 9

---

## 7. Recommended Fix Approach

1. **Stripe webhook** (lines ~493-497): After setting `status = 'closed'`, also set `v2_status = 'sold'` and `sold_at = now()` on consumed stock units. Remove the separate `v2-process-order` call since it's redundant.

2. **eBay process-order** (Step 9, lines ~960-989): Remove the legacy FIFO depletion entirely. Let `v2-process-order` handle it via `v2_consume_fifo_unit()` (which correctly sets both statuses). Ensure `v2-process-order` is called with `await` not fire-and-forget.

3. **Data repair**: Run a one-time SQL update to fix existing ghost units:
   ```sql
   UPDATE stock_unit
   SET v2_status = 'sold', sold_at = COALESCE(sold_at, now())
   WHERE status = 'closed'
     AND v2_status IN ('graded', 'listed');
   ```

4. **Long-term**: Deprecate the `status` column entirely. All logic should use `v2_status` only.

