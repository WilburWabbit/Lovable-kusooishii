

# Add VAT Calculations to Payout Detail Transactions

## Summary
Add VAT (ex-VAT / VAT amount) columns to the transactions table, expanded fee detail rows, and the summary totals. Default rate: 20% for all eBay channel fees and amounts, consistent with the existing fee breakdown section.

## Changes — `src/components/admin-v2/PayoutDetail.tsx` only

### 1. Top-level summary cards
Add a second row of 3 cards below the existing Gross/Fees/Net:
- **Ex-VAT Revenue** — `grossAmount / 1.2`
- **VAT on Fees** — `totalFees / 1.2 * 0.2` (reclaimable input VAT)
- **Ex-VAT Net** — `netAmount / 1.2`

### 2. Transactions table columns
Add two columns after "Net":
- **Ex-VAT** — `grossAmount / 1.2` (net revenue after output VAT)
- **VAT on Fees** — `totalFees / 1.2 * 0.2` (input VAT reclaimable on fees)

Update footer totals to include these two new columns.

### 3. Expanded fee detail sub-rows
For each individual fee line, show:
- Fee Type | Gross | Ex-VAT | VAT
- Where Ex-VAT = `amount / 1.2`, VAT = `amount - exVAT`

### 4. Linked Orders table
Add an "Ex-VAT" column next to each fee total showing the net-of-VAT figure.

### 5. Use shared VAT utility
Import `calculateVAT` from `@/lib/utils/vat` instead of inline `/1.2` arithmetic, for consistency with the rest of the codebase.

## No database, hook, or edge function changes needed.

