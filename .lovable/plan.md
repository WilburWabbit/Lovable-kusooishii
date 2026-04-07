

# Fix VAT Calculation Errors in Order P&L

## Problem

`landed_cost` / `cogs` is stored **ex-VAT** (confirmed: £9.03 in DB). But everywhere in the code it's divided by 1.2 as if it were gross, producing wrong COGS (£7.53 instead of £9.03), wrong VAT reclaim, and wrong net profit.

Three specific errors:

1. **COGS divided by 1.2 incorrectly** — `OrderDetail.tsx` line 110: `netCogs = exVAT(totalCogs)` and line 257: `exVAT(item.cogs)`. Since cogs is already ex-VAT, this should be used as-is.

2. **`unit_profit_view`** does `landed_cost / 1.2` for `net_landed_cost` — same error at the database level.

3. **VAT reclaim on stock** is derived from the wrong COGS (`totalCogs - netCogs`), producing £1.50 instead of £1.81 (which is `cogs × 0.2`).

### Expected values (example order)
- COGS: £9.03 (as stored, already ex-VAT)
- Input VAT on stock: £9.03 × 0.2 = £1.81
- Input VAT on fees: £5.65 − £4.71 = £0.94
- Total VAT reclaim: £2.75
- Net profit: £13.33 − £9.03 − £4.71 = −£0.41

## Changes

### 1. Migration: Fix `unit_profit_view`

Replace `landed_cost / 1.2` with `landed_cost` (it's already ex-VAT):

```sql
-- net_landed_cost: use as-is (already ex-VAT)
COALESCE(su.landed_cost, 0) AS net_landed_cost,
-- net_profit: revenue/1.2 - landed_cost - fees/1.2
round(sol.unit_price / 1.2 - COALESCE(su.landed_cost, 0) - ..., 4) AS net_profit
```

### 2. `OrderDetail.tsx` — Fix order-level P&L

```typescript
// COGS is already ex-VAT, don't divide again
const netCogs = totalCogs;              // was: exVAT(totalCogs)
const netFees = exVAT(totalOrderFees);  // fees ARE gross, this is correct

// VAT reclaim: input VAT on stock = cost × 0.2
const vatReclaimCogs = totalCogs * 0.2;           // was: totalCogs - netCogs
const vatReclaimFees = totalOrderFees - netFees;   // correct as-is
```

Per-line COGS display (line 257): show `item.cogs` directly instead of `exVAT(item.cogs)`.

### 3. `OrderUnitSlideOut.tsx` — Fix unit-level P&L

Lines 42-44: VAT reclaim on cost should be `landed_cost × 0.2`, not `landed_cost - net_landed_cost` (since `net_landed_cost` will now equal `landed_cost`).

```typescript
const vatReclaimCost = profit ? profit.landedCost * 0.2 : 0;
```

### 4. `use-payouts.ts` — No mapper changes needed

The mapper just reads the view columns. Once the view is fixed, `netLandedCost` will carry