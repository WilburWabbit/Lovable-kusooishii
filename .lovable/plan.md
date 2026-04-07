

# Rebuild Payouts UI and Surface Fees Across Relevant Screens

## Problem

1. **PayoutView** uses hardcoded fee categories (`fvf`, `promoted_listings`, `international`, `processing`) that don't match real data (`ebay_selling_fees`, `ebay_shipping`, `ebay_other_fees`). The detail slide-out shows zeros for everything.
2. The reconcile button gives no feedback about what it does or did.
3. Linked orders per payout are not shown despite `payout_orders` having real data.
4. Three hooks already exist (`useOrderFees`, `usePayoutFees`, `useUnitProfit`) but are **never used** in any component. Fee and profit data is invisible across all screens.

## What changes

### 1. PayoutView — Rebuild with real data

**File: `src/components/admin-v2/PayoutView.tsx`**

- **FeeBreakdown type**: Change from hardcoded 4-field interface to `Record<string, number>`. Update `src/lib/types/admin.ts` accordingly.
- **Main table columns**: Remove hardcoded FVF/Promoted/International/Processing columns. Replace with a single "Selling Fees" / "Shipping" / "Other" set matching real `fee_breakdown` keys, or just keep Gross/Fees/Net and add a `reconciliation_status` column.
- **Detail slide-out**: Rebuild with three sections:
  1. **Totals** — Gross, Fees, Net, Reconciliation status badge
  2. **Fee Breakdown** — Dynamically render from `fee_breakdown` JSONB keys with formatted labels (e.g., `ebay_selling_fees` → "Selling Fees")
  3. **Linked Orders** — Use `usePayoutFees` to group fees by `external_order_id`, showing each order's selling fees, shipping, and other fees. Link to order detail where `sales_order_id` exists.
- **Reconcile button**: After reconciliation completes, show result counts (matched/unmatched) in a toast. Add a status badge showing "Reconciled" vs "Pending".
- **Create Payout dialog**: Update fee inputs to match real categories (Selling Fees, Shipping, Other) instead of FVF/Promoted/International/Processing.

### 2. OrderDetail — Show fees and profit per unit

**File: `src/components/admin-v2/OrderDetail.tsx`**

- Add `useOrderFees(orderId)` call to fetch all `payout_fee` rows for this order.
- Add a **Fees & Costs** summary card row showing: Total Selling Fees, Shipping Costs, Other Fees.
- In the line items table, add a "Fees" column showing per-unit fee total (from `useUnitProfit` or aggregated from `payout_fee` by `external_order_id`).
- Add a "Profit" summary card: Revenue - COGS - Fees = Net Profit.

### 3. OrderUnitSlideOut — Show unit-level P&L

**File: `src/components/admin-v2/OrderUnitSlideOut.tsx`**

- When a stock unit is linked, use `useUnitProfit(stockUnitId)` to show: Revenue, Landed Cost, Selling Fee, Shipping Fee, Processing Fee, Net Profit, Margin %.

### 4. Type updates

**File: `src/lib/types/admin.ts`**

- Change `FeeBreakdown` from `{ fvf; promoted_listings; international; processing }` to `Record<string, number>`.
- Add `reconciliationStatus` field to `Payout` interface.

### 5. Hooks mapper update

**File: `src/hooks/admin/use-payouts.ts`**

- Update `mapPayout` to include `reconciliationStatus` from `reconciliation_status` column.
- Update `CreatePayoutInput` fee breakdown to use dynamic keys.

## Files changed

| File | Change |
|------|--------|
| `src/lib/types/admin.ts` | `FeeBreakdown` → `Record<string, number>`, add `reconciliationStatus` to `Payout` |
| `src/hooks/admin/use-payouts.ts` | Update `mapPayout`, update `CreatePayoutInput` |
| `src/components/admin-v2/PayoutView.tsx` | Rebuild detail slide-out with dynamic fees + linked orders; fix columns; improve create dialog; add reconciliation status |
| `src/components/admin-v2/OrderDetail.tsx` | Add fee summary cards and profit calculation using `useOrderFees` |
| `src/components/admin-v2/OrderUnitSlideOut.tsx` | Add unit P&L section using `useUnitProfit` |

