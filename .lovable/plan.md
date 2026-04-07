

# Redesign Order Detail as Invoice-Style Layout

## Problem

The current order detail page has a confusing layout with multiple rows of summary cards followed by a flat table. The user wants it redesigned to match the purchase batch detail pattern — structured like an invoice with a clear per-line VAT breakdown.

## Current state

- Multiple rows of summary cards (revenue, VAT, QBO, COGS, fees, profit, margin) are scattered
- Line items shown in a flat table with columns like "Payout", "Tracking", "Status" mixed in
- No per-line VAT amount shown
- Hard to read as an invoice

## Data available

- `sales_order_line` has `unit_price` (gross), `line_total`, `cogs`, `vat_rate_id`
- `vat_rate` has `rate_percent` (currently 20% for all lines)
- Per-line VAT can be computed: `unit_price / 1.2` = net, `unit_price - net` = VAT
- Fee data already loaded via `useOrderFees`

## Design

Restructure to an invoice-style layout:

### 1. Header — compact order info
Keep: external ref as heading, status badge, customer, channel, date, QBO status. Remove internal order number from prominent display.

### 2. Invoice line items table
Replace the current table with invoice-style columns:

| Item | SKU | Qty | Unit (ex-VAT) | VAT | Line Total | COGS |
|------|-----|-----|---------------|-----|------------|------|

Each row shows the product name, SKU code, quantity (always 1 currently), ex-VAT unit price, VAT amount, gross line total, and COGS if allocated.

### 3. Invoice totals section
Below the line items table, a right-aligned totals block (like a real invoice):

```text
                    Subtotal (ex-VAT):  £XX.XX
                              VAT 20%:  £XX.XX
                          Gross Total:  £XX.XX
```

### 4. P&L summary card
A single card below the invoice replacing the scattered summary cards:

```text
  Net Revenue    £XX.XX
  COGS (ex-VAT)  £XX.XX
  Fees (ex-VAT)  £XX.XX
  ──────────────────────
  Net Profit     £XX.XX   (XX.X% margin)
  VAT Reclaim    £XX.XX
```

### 5. Fee breakdown
Keep the existing fee breakdown card, unchanged.

### 6. Unit detail
The "View Unit" button stays on each line item row for the slide-out.

## Changes required

### `src/lib/types/admin.ts`
- Add `vatRate` (number) and `lineVat` (number) to `OrderLineItem`

### `src/hooks/admin/use-orders.ts`
- Join `vat_rate` via `vat_rate_id` in the line item query
- Map `rate_percent` into `vatRate`, compute `lineVat` from `unit_price`

### `src/components/admin-v2/OrderDetail.tsx`
- Replace summary card rows with compact header metadata
- Replace line items table with invoice-style table (Item, SKU, Qty, Unit ex-VAT, VAT, Line Total, COGS, action)
- Add invoice totals section below the table
- Add a single P&L summary card replacing the scattered cards
- Keep fee breakdown card, action buttons, and mobile sticky actions as-is

## Files changed

| File | Change |
|------|--------|
| `src/lib/types/admin.ts` | Add `vatRate`, `lineVat` to `OrderLineItem` |
| `src/hooks/admin/use-orders.ts` | Join `vat_rate` table, map new fields |
| `src/components/admin-v2/OrderDetail.tsx` | Rebuild as invoice-style layout |

