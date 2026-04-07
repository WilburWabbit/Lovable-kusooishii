

# Use QBO Location/Store as Canonical Channel Source

## Current state

The `detectOriginChannel` function uses fragile DocNumber regex patterns and PaymentMethodRef fallbacks to guess the channel. This works most of the time but is brittle — 315 of 331 sales receipts have `DepartmentRef = NULL` (defaulting to eBay via fallback), while the remaining 16 have explicit Location values.

The QBO `DepartmentRef` field is already present in every `landing_raw_qbo_sales_receipt.raw_payload`. The five Location/Store values in QBO map cleanly:

| QBO DepartmentRef.name | QBO ID | → `origin_channel` |
|---|---|---|
| `eBay` | 1000000001 | `ebay` |
| `kusooishii.com` | 1000000011 | `web` |
| `In Person Sales` | 1000000021 | `in_person` |
| `Etsy` | 1000000031 | `etsy` |
| `kusooishii.com:Square Space` | 1000000041 | `squarespace` |
| NULL (no DepartmentRef) | — | `ebay` (default) |

## Changes

### 1. Update `detectOriginChannel` in `qbo-process-pending/index.ts`

Replace the current DocNumber/PaymentMethodRef heuristic with a `DepartmentRef`-first approach:

```
function detectOriginChannel(receipt: any): string {
  const deptName = receipt.DepartmentRef?.name ?? null;
  
  if (deptName) {
    if (/ebay/i.test(deptName)) return "ebay";
    if (/square\s*space/i.test(deptName)) return "squarespace";
    if (/kusooishii/i.test(deptName)) return "web";
    if (/in\s*person/i.test(deptName)) return "in_person";
    if (/etsy/i.test(deptName)) return "etsy";
  }
  
  // Fallback: NULL DepartmentRef → eBay (per business rule)
  // Keep existing DocNumber/PaymentMethodRef logic as secondary fallback
  ...existing regex logic...
}
```

DepartmentRef is checked first. If present, it's authoritative. If absent, the existing DocNumber/PaymentMethodRef logic runs as a safety net, with the final default remaining `ebay` instead of `in_person`.

### 2. Add `squarespace` as a recognized channel value

The `origin_channel` column is plain `text`, so no migration is needed. The UI channel filter and any display logic should handle `squarespace` as a label (e.g., "Square Space" or "SquareSpace"). One small update in the admin UI where channel badges/labels are rendered.

### 3. Backfill existing orders

A one-time data correction via migration to update orders that were misclassified:

```sql
-- Update orders where we can re-derive channel from the QBO payload
UPDATE sales_order so
SET origin_channel = CASE
  WHEN lr.raw_payload->'DepartmentRef'->>'name' ~* 'ebay' THEN 'ebay'
  WHEN lr.raw_payload->'DepartmentRef'->>'name' ~* 'square.*space' THEN 'squarespace'
  WHEN lr.raw_payload->'DepartmentRef'->>'name' ~* 'kusooishii' THEN 'web'
  WHEN lr.raw_payload->'DepartmentRef'->>'name' ~* 'in.*person' THEN 'in_person'
  WHEN lr.raw_payload->'DepartmentRef'->>'name' ~* 'etsy' THEN 'etsy'
  ELSE so.origin_channel
END
FROM landing_raw_qbo_sales_receipt lr
WHERE lr.external_id = so.qbo_sales_receipt_id
  AND lr.raw_payload->'DepartmentRef' IS NOT NULL
  AND lr.raw_payload->>'DepartmentRef' != 'null';
```

### 4. Fix the default fallback

Change the final fallback in `detectOriginChannel` from `return "in_person"` to `return "ebay"` — matching the business rule that NULL Location = eBay.

## Files changed

| File | Change |
|---|---|
| `supabase/functions/qbo-process-pending/index.ts` | Rewrite `detectOriginChannel` to use `DepartmentRef` first, change default fallback to `ebay` |
| `supabase/migrations/...` | Backfill `origin_channel` on existing orders using QBO payload DepartmentRef |
| `src/components/admin-v2/OrderList.tsx` | Add `squarespace` to channel filter/badge display (if present) |

## Expected outcome

- All future QBO sales receipts get their channel from the authoritative QBO Location field
- Existing orders with QBO DepartmentRef data are corrected
- The 315 NULL-location orders remain as `ebay` (correct per business rule)
- SquareSpace orders are distinguished from other in-person sales

