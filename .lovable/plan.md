

# VAT-Net P&L: Apply VAT Netting Across All Cost Components

## Problem

The current profit calculations mix gross (VAT-inclusive) amounts. Revenue is shown gross, COGS includes reclaimable purchase VAT, and eBay fees/shipping labels include reclaimable input VAT. For a true P&L, all components must be compared on a net (ex-VAT) basis since the business reclaims input VAT.

**Current state** (example order `14-14455-15038`):
- Revenue: £15.99 gross → should be £13.33 net
- COGS: £9.03 (includes purchase VAT) → should be £7.53 net
- Fees: £5.65 (eBay charges VAT on fees) → should be £4.71 net
- Profit: currently £15.99 - £9.03 - £5.65 = £1.31 (wrong basis)
- Correct: £13.33 - £7.53 - £4.71 = £1.09

## Design

All three cost pillars — revenue, COGS, and fees — get VAT-netted at 20%. The `exVAT()` utility already exists in both frontend (`src/lib/utils/vat.ts`) and backend (`supabase/functions/_shared/vat.ts`).

## Changes

### 1. Update `unit_profit_view` (migration)

Replace the view to compute all values ex-VAT:

```sql
-- Revenue: unit_price / 1.2
-- Landed cost: landed_cost / 1.2 (input VAT reclaimable)
-- Fees: each fee / 1.2 (input VAT on eBay fees reclaimable)
-- Net profit: net_revenue - net_cost - net_fees
```

Add explicit columns: `gross_revenue`, `net_revenue`, `net_landed_cost`, `net_total_fees`, keeping gross columns for reference.

### 2. Update `OrderDetail.tsx` — order-level P&L

Currently: `netProfit = order.netAmount - totalCogs - totalOrderFees`

Change to use ex-VAT values for COGS and fees:
- COGS displayed as ex-VAT: `exVAT(totalCogs)`
- Fees displayed as ex-VAT: `exVAT(totalOrderFees)`
- Profit: `order.netAmount - exVAT(totalCogs) - exVAT(totalOrderFees)`

Add a "VAT Reclaim" summary row showing total reclaimable input VAT (purchase VAT + fee VAT).

### 3. Update `OrderUnitSlideOut.tsx` — unit-level P&L

The Unit P&L section currently shows gross values. Update to show:
- Revenue (ex-VAT)
- Landed Cost (ex-VAT)
- Each fee category (ex-VAT)
- Input VAT reclaim line
- Net Profit (all ex-VAT)

### 4. Update `useUnitProfit` mapper and `UnitProfit` type

Add `netRevenue`, `netLandedCost`, `netTotalFees` fields from the updated view.

### 5. Update `PayoutView.tsx` — payout summary

Fee totals displayed in the payout detail should show both gross and net (ex-VAT) amounts.

## Files changed

| File | Change |
|------|--------|
| Migration SQL | Recreate `unit_profit_view` with ex-VAT columns |
| `src/components/admin-v2/OrderDetail.tsx` | Use `exVAT()` for COGS and fees in P&L cards; add VAT reclaim row |
| `src/components/admin-v2/OrderUnitSlideOut.tsx` | Show ex-VAT values in unit P&L |
| `src/hooks/admin/use-payouts.ts` | Update `UnitProfit` type and mapper for new view columns |
| `src/components/admin-v2/PayoutView.tsx` | Show net fee amounts in payout detail |

## Expected outcome

All profit figures reflect true economic profit after VAT netting. Revenue, costs, and fees are all compared on the same ex-VAT basis. Reclaimable input VAT is surfaced as a separate line item for visibility.

