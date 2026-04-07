

# Fix: Sales Reconciliation Comparing Net vs Gross

## Root Cause

Line 2164 of `admin-data/index.ts` compares QBO's `TotalAmt` against the app's `gross_total`. Because all sales receipts use `GlobalTaxCalculation: TaxExcluded`, QBO's `TotalAmt` is the **net** (ex-VAT) amount, while the app's `gross_total` is **VAT-inclusive**.

Example: QBO 631 has `TotalAmt: 69.95` + `TotalTax: 11.66` = 81.61 gross. The app correctly stores `gross_total: 81.61`. The reconciliation reports a mismatch because it compares 69.95 vs 81.61.

## Fix

**File**: `supabase/functions/admin-data/index.ts`, line 2164

Change the QBO total calculation to include tax:

```typescript
// Before (line 2164):
const qboTotal = Math.round(Number(qbo.TotalAmt ?? 0) * 100) / 100;

// After:
const qboNet = Number(qbo.TotalAmt ?? 0);
const qboTax = Number(qbo.TxnTaxDetail?.TotalTax ?? 0);
const qboTotal = Math.round((qboNet + qboTax) * 100) / 100;
```

This makes the comparison apples-to-apples (both gross/VAT-inclusive), which is exactly how the app stores these values.

One file change, one line expanded to three. No other files affected.

