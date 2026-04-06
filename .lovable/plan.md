

# Fix QBO Processor — Idempotency, Channel Detection, Dates, v2_status

## Problem Summary

After "Rebuild from QBO", data is severely corrupted by 6 distinct bugs:

1. **Receipt lines multiplied ~10x** — Purchase 1733 has 169 QBO lines but 1611 receipt lines and 630 stock units. The shortfall guard on line 647 only checks existing stock per receipt line ID, but the receipt lines themselves are recreated every run because the "pending receipt" path (line 486-492) only nullifies stock unit links before deleting lines — it doesn't prevent new lines from being created on every invocation.

2. **All orders show `origin_channel: qbo`** — Hardcoded on line 774. eBay (`14-14455-15040`), Square (`SQR-01000`), Etsy (`ETSY-3121423800`) all misattributed.

3. **Order dates show rebuild time** — `created_at` defaults to `now()` on insert. The QBO `TxnDate` is stored in `txn_date` but `created_at` is never overridden.

4. **`v2_status` is NULL on all stock** — Stock inserts (line 656) omit `v2_status` and `graded_at`. 404 units with `status: available, v2_status: NULL`.

5. **`allocate_stock_units` SQL function only sets `status = 'closed'`** — Doesn't update `v2_status`, `sold_at`, or `order_id`. 254 closed units have NULL `v2_status`.

6. **No payout data rebuilt** — eBay payout landing table is empty. This is a known data gap (payouts were never landed).

## Root Cause of Duplication (Bug 1 — Critical)

The processor's purchase path has a fatal idempotency flaw:

- After rebuild, all landing records are `pending`, and receipts are deleted.
- The processor picks up 15 records per batch. For each, it upserts a receipt (creates new), then creates lines + stock.
- The processor is invoked multiple times (webhook auto-trigger + manual drain loop).
- On subsequent runs, the same landing record is still `pending` (or was re-triggered). The receipt now exists with `status: pending` (line 486 branch). This branch clears stale lines but only nullifies `inbound_receipt_line_id` on linked stock — it does NOT delete the stock. Then it falls through and creates ALL new lines + stock again.
- The shortfall guard (line 647) counts stock per NEW receipt line ID (just inserted), so count is always 0. Full duplication every run.

## Plan

### Step 1: Fix purchase idempotency in `qbo-process-pending`

Add a true idempotency guard at the top of the purchase loop: after upserting the receipt, count existing receipt lines. If the line count matches the expected QBO line count AND receipt status is `processed`, mark as committed and skip. This prevents re-expansion entirely.

For the "pending receipt with existing lines" path (line 486), change from nullifying stock `inbound_receipt_line_id` to **deleting** orphaned stock units that aren't closed/sold, then delete old lines.

### Step 2: Add `v2_status` to stock unit creation

In `processPurchases` (line 656), add `v2_status: "graded"` and `graded_at: new Date().toISOString()` to every stock unit insert.

### Step 3: Fix channel detection in `processSalesReceipts`

Replace hardcoded `originChannel = "qbo"` (line 774) with detection logic:

```text
DocNumber patterns:
  /^\d{2}-\d{5}-\d{5}$/  → "ebay"
  /^KO-/                  → "website"
  /^SQR-/                 → "square"
  /^ETSY-/                → "etsy"
  PaymentMethodRef.name containing "Stripe" → "website"
  PaymentMethodRef.name containing "eBay"   → "ebay"
  default → "qbo"
```

### Step 4: Fix order `created_at` from QBO TxnDate

In the order insert payload (line 874), add `created_at: txnDate ? new Date(txnDate).toISOString() : new Date().toISOString()` so orders sort by transaction date, not rebuild time.

### Step 5: Update `allocate_stock_units` SQL function

Migration to add `v2_status`, `sold_at`, and `order_id` handling:

```sql
-- Also set v2_status = 'sold', sold_at = now()
UPDATE public.stock_unit
SET status = 'closed', v2_status = 'sold', sold_at = now(), updated_at = now()
WHERE id = ANY(v_unit_ids);
```

Then after allocation in `processSalesReceipts`, update `order_id` on the allocated units.

### Step 6: Delete SKUs during rebuild

Add SKU deletion to the rebuild (after stock/receipts are deleted, before landing reset). SKUs are recreated by the processor from QBO item data — they should not be preserved if we're treating QBO as absolute truth. Only the `sku` table rows are deleted; `lego_catalog` and `product` remain.

### Step 7: Rebuild cleanup additions

Also delete from `vendor` table (vendors are rebuilt from `landing_raw_qbo_vendor`). Add `product` table cleanup for products without any `lego_catalog` link or media — these are stubs auto-created by the processor and will be recreated.

## Files Modified

1. `supabase/functions/qbo-process-pending/index.ts` — idempotency guard, v2_status on stock, channel detection, created_at override, order_id on allocated stock
2. `supabase/functions/admin-data/index.ts` — SKU + vendor deletion in rebuild
3. Database migration — update `allocate_stock_units` function to set `v2_status`, `sold_at`

## Technical Details

### Idempotency Guard (purchase processing)

```typescript
// After receipt upsert, before creating lines:
const { count: existingLineCount } = await admin.from("inbound_receipt_line")
  .select("id", { count: "exact", head: true })
  .eq("inbound_receipt_id", receipt.id);

const expectedLineCount = (purchase.Line ?? []).filter(
  (l: any) => l.DetailType === "ItemBasedExpenseLineDetail" || l.DetailType === "AccountBasedExpenseLineDetail"
).length;

if (receipt.status === "processed" && (existingLineCount ?? 0) === expectedLineCount) {
  await markLanding(admin, "landing_raw_qbo_purchase", entry.id, "committed");
  processed++;
  continue;
}
```

### Channel Detection

```typescript
function detectOriginChannel(receipt: any): string {
  const doc = receipt.DocNumber ?? "";
  if (/^\d{2}-\d{5}-\d{5}$/.test(doc)) return "ebay";
  if (doc.startsWith("KO-")) return "website";
  if (doc.startsWith("SQR-")) return "square";
  if (doc.startsWith("ETSY-")) return "etsy";
  if (doc.startsWith("R-SQR-") || doc.startsWith("R-ETSY-") || doc.startsWith("R-")) return "qbo_refund";
  const pmtName = receipt.PaymentMethodRef?.name ?? "";
  if (/stripe/i.test(pmtName)) return "website";
  if (/ebay/i.test(pmtName)) return "ebay";
  return "qbo";
}
```

### Rebuild additions

```text
After Step 3 (delete stock) and Step 4 (delete receipts):
  Step 4b: Delete ALL SKUs
  Step 4c: Delete ALL vendors
  Step 4d: Delete products without lego_catalog_id or media
```

