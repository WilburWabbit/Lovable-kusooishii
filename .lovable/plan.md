

# Fix: eBay Total Calculation in Channel Card

## Problem

The `ebayTotal` computation in `PayoutDetail.tsx` sums all transaction `net_amount` values directly, but they are **all stored as positive** in the database. The code comment says "net_amount is already signed correctly from eBay" — this is wrong. SHIPPING_LABEL, NON_SALE_CHARGE are stored as positive values that should be subtracted; TRANSFER should be added back.

Current result: 355.42 (sum of all positives)
Correct result: 222.06 (SALE nets − SHIPPING_LABEL − NON_SALE_CHARGE + TRANSFER)

## Fix — `src/components/admin-v2/PayoutDetail.tsx` (lines 175-179)

Replace the reduce with sign-aware logic:

```typescript
const ebayTotal = transactions.reduce((sum, tx) => {
  const amt = tx.netAmount;
  switch (tx.transactionType) {
    case "SALE":
    case "TRANSFER":
      return sum + amt;
    case "SHIPPING_LABEL":
    case "NON_SALE_CHARGE":
      return sum - amt;
    default:
      return sum + amt;
  }
}, 0);
```

This matches the formula from the approved plan: `Σ SALE.net + Σ TRANSFER.net − Σ SHIPPING_LABEL.net − Σ NON_SALE_CHARGE.net = 222.06`

## Scope

| File | Change |
|------|--------|
| `src/components/admin-v2/PayoutDetail.tsx` | Fix ebayTotal sign logic in reduce (lines 175-179) |

Single-file, ~5-line change. No backend or migration needed.

