

# Debug: In-Person Sales Not Sent to QBO

## Root Cause

The `qbo-sync-sales-receipt` edge function uses `TaxCodeRef: { value: "20.0 S" }` (line 77) — passing the **display name** instead of the **QBO numeric tax code ID**. The QBO API requires the ID.

From the database, the "20.0% S" tax code has `qbo_tax_code_id: 6`. The function should use `{ value: "6" }`.

**Evidence**: Edge function logs show:
```
QBO SalesReceipt creation failed [400]:
"Business Validation Error: Make sure all your transactions have a VAT rate before you save."
```

### Order status:
- **KO-0009631** (`needs_manual_review`): QBO call was made but rejected due to invalid tax code ref
- **KO-0009630** (`pending`): QBO call likely failed silently (the `.catch(() => {})` in CashSaleForm swallows errors)

## Fix

### 1. `supabase/functions/qbo-sync-sales-receipt/index.ts`

Change the hardcoded `TaxCodeRef` from the display name to the numeric QBO ID:

```typescript
// Before (line 77)
TaxCodeRef: { value: "20.0 S" },

// After
TaxCodeRef: { value: "6" },
```

Ideally, look up the tax code from the `tax_code` table dynamically, but the hardcoded `"6"` matches the existing QBO configuration and is consistent with how other QBO sync functions work.

### 2. Retry the two failed orders

After deploying the fix, manually retry both orders by invoking the edge function for each order ID, or provide a UI action to retry from the order detail page.

## Files changed

| File | Change |
|------|--------|
| `supabase/functions/qbo-sync-sales-receipt/index.ts` | Fix TaxCodeRef value from `"20.0 S"` to `"6"` |

