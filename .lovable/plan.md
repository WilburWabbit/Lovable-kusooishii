

# Show Raw Payout Transactions on Payout Detail Page

## What this adds
A new "Transactions" section on the payout detail page showing every raw line item from the source channel (eBay/Stripe), with the matched internal order data alongside. This gives full visibility into what the channel reported vs what the app has recorded.

## Data source
- **eBay**: `ebay_payout_transactions` table, joined by `payout_id` (the external payout ID string, e.g. `7438552070`)
- **Stripe**: `landing_raw_stripe_event` filtered by payout-related event types (future — no Stripe payout transactions exist yet)
- Each transaction row has: type (SALE, SHIPPING_LABEL, TRANSFER, NON_SALE_CHARGE), gross/fees/net, buyer, order ID, and match status

## Implementation

### 1. New hook: `usePayoutTransactions` in `src/hooks/admin/use-payouts.ts`
- Query `ebay_payout_transactions` where `payout_id = payout.externalPayoutId`
- Left-join matched order data via `matched_order_id` (or fetch separately)
- For matched transactions, also fetch the internal order's `gross_total` to show side-by-side
- Return typed array with transaction + optional matched order gross

### 2. Update `src/components/admin-v2/PayoutDetail.tsx`
- Add a new `SurfaceCard` section titled "Transactions" between the fee breakdown and linked orders sections
- Table columns:
  - **Type** — transaction_type badge (SALE / SHIPPING_LABEL / TRANSFER / NON_SALE_CHARGE)
  - **Order / Memo** — eBay order ID or memo text
  - **Buyer** — buyer_username
  - **Gross** — from channel
  - **Fees** — from channel
  - **Net** — from channel
  - **App Gross** — from matched internal order (or "—" if unmatched)
  - **Variance** — difference between channel gross and app gross (highlighted if non-zero)
  - **Status** — matched/unmatched badge
- Footer row with totals
- Clickable order ID links to internal order detail when matched
- Transaction type shown as coloured badges (sale=green, shipping=blue, charge=amber, transfer=zinc)

### 3. No database changes needed
All data already exists in `ebay_payout_transactions` and `sales_order`.

## Files to change
- `src/hooks/admin/use-payouts.ts` — add `usePayoutTransactions` hook
- `src/components/admin-v2/PayoutDetail.tsx` — add Transactions section

