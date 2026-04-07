

# Fix Purchase and Sales Reconciliation — Two Bugs

## Issue 1: 537 Purchases "Missing" — False Positives

**Root cause**: The reconciliation at line 2116 queries `SELECT * FROM Purchase` from QBO, returning ALL 623 purchase records (expenses, checks, credit card charges, etc.). But the processor (`qbo-process-pending`, line 431-435) intentionally skips any purchase that has no `ItemBasedExpenseLineDetail` lines — these are pure expense purchases with no inventory items. The 537 "missing" records are expenses that the app correctly never imported.

**Fix**: Filter the QBO results in the reconciliation to only include purchases that have at least one `ItemBasedExpenseLineDetail` line, matching the processor's logic.

```typescript
// Line ~2116-2117: after fetching qboRecords, filter before building the map
const qboRecords = await queryQbo("SELECT * FROM Purchase", "Purchase");
const inventoryPurchases = qboRecords.filter((r: any) =>
  (r.Line ?? []).some((l: any) => l.DetailType === "ItemBasedExpenseLineDetail")
);
totalQbo = inventoryPurchases.length;
const qboMap = new Map(inventoryPurchases.map((r: any) => [String(r.Id), r]));
```

## Issue 2: 220 Sales "Mismatched" — Tax Mode Not Checked

**Root cause**: The previous fix (line 2164-2166) always computes QBO total as `TotalAmt + TotalTax`. This is only correct for `TaxExcluded` receipts. For `TaxInclusive` receipts, `TotalAmt` already includes tax — adding `TotalTax` again double-counts it, producing an inflated QBO figure.

The processor itself handles this correctly (lines 924-931 of `qbo-process-pending`), checking `GlobalTaxCalculation` per receipt. The reconciliation must do the same.

**Fix**: Mirror the processor's logic — check `GlobalTaxCalculation` per QBO record:

```typescript
// Lines 2164-2166: replace the fixed addition with per-receipt check
const globalTaxCalc = qbo.GlobalTaxCalculation ?? null;
const qboTotalAmt = Number(qbo.TotalAmt ?? 0);
const qboTaxAmt = Number(qbo.TxnTaxDetail?.TotalTax ?? 0);
const qboTotal = Math.round(
  (globalTaxCalc === "TaxInclusive" ? qboTotalAmt : qboTotalAmt + qboTaxAmt) * 100
) / 100;
```

## Changes

**Single file**: `supabase/functions/admin-data/index.ts`
- Lines 2116-2118: Filter QBO purchases to inventory-only
- Lines 2164-2166: Add `GlobalTaxCalculation` check per sales receipt

No other files affected. No migrations needed.

