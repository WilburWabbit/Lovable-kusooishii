

# Payout Detail Page — Expandable Transaction Rows + Card Reorder

## Problems to fix
1. **No per-line fee detail** — each transaction has `fee_details` JSONB (e.g. FINAL_VALUE_FEE, REGULATORY_OPERATING_FEE) but the UI doesn't show it
2. **Card order wrong** — user wants: Gross/Fees/Net → Channel Detail → Transactions → Linked Orders → Fee Breakdown. Remove "Fee Detail by Category" entirely
3. **Unit count wrong** — the channel card shows 9 (from `payout_orders` join) but the payout only has 1 SALE transaction. Fix: derive unit count from transaction SALE rows, not from `payout_orders`

## Changes

### 1. `src/components/admin-v2/PayoutDetail.tsx`

**Expandable transaction rows:**
- Add local state `expandedTxIds: Set<string>` toggled on row click
- When a row is expanded, render a sub-row below it showing the `fee_details` array from that transaction as a mini table:
  - Fee Type | Amount
  - e.g. `Final Value Fee | £2.09`, `Regulatory Operating Fee | £0.07`, `Final Value Fee Fixed Per Order | £0.48`
- Use Collapsible or simple conditional rendering with a chevron indicator on each row

**Reorder sections to:**
1. Gross / Fees / Net cards (unchanged)
2. Channel Detail card (meta) — fix unit count
3. Transactions card (with expandable rows)
4. Linked Orders card
5. Fee Breakdown card (from JSONB)
6. Action buttons

**Remove:** "Fee Detail by Category" section entirely (lines 203-216)

**Fix unit count in channel card:**
- Change from `liveUnitCount` (payout_orders-based) to counting SALE-type transactions from the `transactions` array
- `const saleCount = transactions.filter(t => t.transactionType === 'SALE').length`
- Display this as the unit count

### 2. `src/hooks/admin/use-payouts.ts`
- No changes needed — `feeDetails` is already included in `PayoutTransaction` type and mapped from the query

## No database or edge function changes.

