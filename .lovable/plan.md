

# Revised Plan: Use QBO DepartmentRef as Canonical Channel Source

## What changes

Rewrite `detectOriginChannel` to check `DepartmentRef` first. Keep the existing DocNumber regex logic as a secondary fallback (do NOT remove it). Change the final default from `in_person` to `ebay`.

Backfill existing orders where `DepartmentRef` is available in the landing payload. Orders with NULL DepartmentRef and no existing channel keep `ebay`.

## Changes

### 1. `supabase/functions/qbo-process-pending/index.ts` — `detectOriginChannel`

Rewrite to prioritize `DepartmentRef.name`:

```
function detectOriginChannel(receipt: any): string {
  // Primary: QBO Location/Store (DepartmentRef)
  const deptName = receipt.DepartmentRef?.name ?? null;
  if (deptName) {
    if (/ebay/i.test(deptName)) return "ebay";
    if (/square\s*space/i.test(deptName)) return "squarespace";
    if (/kusooishii/i.test(deptName)) return "web";
    if (/in\s*person/i.test(deptName)) return "in_person";
    if (/etsy/i.test(deptName)) return "etsy";
  }

  // Secondary fallback: DocNumber pattern (preserved for legacy/edge cases)
  const doc = receipt.DocNumber ?? "";
  if (/^\d{2}-\d{5}-\d{5}$/.test(doc)) return "ebay";
  if (doc.startsWith("KO-")) return "web";
  if (doc.startsWith("SQR-")) return "in_person";
  if (doc.startsWith("ETSY-")) return "etsy";
  if (doc.startsWith("R-SQR-") || doc.startsWith("R-ETSY-") || doc.startsWith("R-KO-")) return "qbo_refund";

  // Tertiary: PaymentMethodRef
  const pmtName = receipt.PaymentMethodRef?.name ?? "";
  if (/stripe/i.test(pmtName)) return "web";
  if (/ebay/i.test(pmtName)) return "ebay";
  if (/square/i.test(pmtName) || /cash/i.test(pmtName)) return "in_person";
  if (/etsy/i.test(pmtName)) return "etsy";

  // Default: NULL DepartmentRef = eBay
  return "ebay";
}
```

`deriveOriginReference` is untouched — it still uses DocNumber for channel-native IDs.

### 2. Migration — Backfill existing orders

Update `origin_channel` on existing `sales_order` rows using the QBO payload's `DepartmentRef` where available:

```sql
UPDATE sales_order so
SET origin_channel = CASE
  WHEN lr.raw_payload->'DepartmentRef'->>'name' ~* 'ebay' THEN 'ebay'
  WHEN lr.raw_payload->'DepartmentRef'->>'name' ~* 'square.*space' THEN 'squarespace'
  WHEN lr.raw_payload->'DepartmentRef'->>'name' ~* 'kusooishii' THEN 'web'
  WHEN lr.raw_payload->'DepartmentRef'->>'name' ~* 'in.*person' THEN 'in_person'
  WHEN lr.raw_payload->'DepartmentRef'->>'name' ~* 'etsy' THEN 'etsy'
  ELSE 'ebay'
END
FROM landing_raw_qbo_sales_receipt lr
WHERE lr.external_id = so.qbo_sales_receipt_id
  AND so.origin_channel IS DISTINCT FROM CASE
    WHEN lr.raw_payload->'DepartmentRef'->>'name' ~* 'ebay' THEN 'ebay'
    WHEN lr.raw_payload->'DepartmentRef'->>'name' ~* 'square.*space' THEN 'squarespace'
    WHEN lr.raw_payload->'DepartmentRef'->>'name' ~* 'kusooishii' THEN 'web'
    WHEN lr.raw_payload->'DepartmentRef'->>'name' ~* 'in.*person' THEN 'in_person'
    WHEN lr.raw_payload->'DepartmentRef'->>'name' ~* 'etsy' THEN 'etsy'
    ELSE 'ebay'
  END;
```

### 3. `src/components/admin-v2/OrderList.tsx` — Add `squarespace` channel display

Add `squarespace` as a recognized channel label (e.g., "Square Space") wherever channel values are displayed or filtered.

## Files changed

| File | Change |
|------|--------|
| `supabase/functions/qbo-process-pending/index.ts` | Rewrite `detectOriginChannel` — DepartmentRef first, DocNumber preserved as fallback, default → `ebay` |
| `supabase/migrations/...` | Backfill `origin_channel` from QBO DepartmentRef |
| `src/components/admin-v2/OrderList.tsx` | Recognize `squarespace` channel in display |

