

# Fix Order Shipping + Lifecycle Statuses

## Problems Identified

### 1. "Ship Order" action fails
The `ShipOrderDialog` writes to wrong columns:
- Sets `status: "shipped"` (legacy `order_status` enum) instead of `v2_status: "shipped"` (the `v2_order_status` enum the app reads)
- Sets `shipped_at` which doesn't exist — the column is `shipped_date` (type `date`)
- Sets `carrier` which doesn't exist — the column is `shipped_via`

### 2. No UPDATE RLS policy on `sales_order`
The only policies are `SELECT` (members read own) and `ALL` (staff manage). The `ALL` policy should cover updates, but let me verify the policy grants to `authenticated` — yes, the `ALL` policy uses `has_role(auth.uid(), 'admin' or 'staff')`, so staff can update. The issue is purely the wrong column names.

### 3. Missing statuses in `v2_order_status` enum
Current enum: `needs_allocation`, `new`, `awaiting_shipment`, `shipped`, `delivered`, `complete`, `return_pending`
Missing: `refunded`, `cancelled`

### 4. No `delivered_at` column on `sales_order`
The `auto-progress-orders` function tries to write `delivered_at` but the column doesn't exist.

### 5. In-person sales not auto-shipped
Cash sales create orders with `v2_status: 'new'` but should be immediately `complete` (items handed over in person).

### 6. eBay orders have no v2_status
All 317 eBay orders have `v2_status: NULL`. They're all `status: 'complete'` (legacy). Need a one-time backfill + daily eBay delivery check.

### 7. No refunded status handling
User wants refunded eBay orders marked as `refunded`. Currently no such enum value exists.

## Changes

### Migration: Schema fixes
```sql
-- Add missing enum values
ALTER TYPE v2_order_status ADD VALUE IF NOT EXISTS 'refunded';
ALTER TYPE v2_order_status ADD VALUE IF NOT EXISTS 'cancelled';

-- Add delivered_at column
ALTER TABLE sales_order ADD COLUMN IF NOT EXISTS delivered_at timestamptz;
```

### Data backfill (via insert tool, not migration)
```sql
-- All eBay orders with legacy status 'complete' → v2_status 'complete'
UPDATE sales_order SET v2_status = 'complete' WHERE origin_channel = 'ebay' AND v2_status IS NULL AND status = 'complete';

-- Mark any with refund indicators as 'refunded' (check qbo_sync_status or notes)
-- (Will verify if any exist — current query shows none with refund status)
```

### `src/components/admin-v2/ShipOrderDialog.tsx`
Fix column names:
- `status: "shipped"` → `v2_status: "shipped"`
- `shipped_at: now` → `shipped_date: now.slice(0,10)` (date column, not timestamptz)
- `carrier` → `shipped_via`

### `src/components/admin-v2/CashSaleForm.tsx`
After successful order creation and allocation, set `v2_status` to `complete` instead of `new` (in-person sales are immediately fulfilled). Also set `shipped_date` and `shipped_via: 'In Person'`.

### `src/lib/types/admin.ts`
Add `'refunded' | 'cancelled'` to `OrderStatus` type.

### `src/hooks/admin/use-orders.ts`
- Fix `mapOrder`: read `shipped_via` for carrier (already correct: line 42 reads `shipped_via`)
- Read `delivered_at` from row
- Handle null `v2_status` by falling back to legacy `status` mapping for old orders

### `src/components/admin-v2/ui-primitives.tsx`
Add badge colors for `refunded` and `cancelled` statuses in `OrderStatusBadge`.

### `supabase/functions/auto-progress-orders/index.ts`
Fix: `shipped_date` is a `date` not `timestamptz`, so the `lt` comparison needs adjustment. Also add `delivered_at` write (now that column exists).

### `supabase/functions/ebay-poll-orders/index.ts` (or new `ebay-check-delivery` function)
Add a daily check against eBay Fulfillment API for orders in `shipped` status to detect delivery confirmation and update to `delivered`.

## Files changed

| File | Change |
|------|--------|
| **Migration** | Add `refunded`/`cancelled` to enum, add `delivered_at` column |
| **Data update** | Backfill eBay orders `v2_status` |
| `src/components/admin-v2/ShipOrderDialog.tsx` | Fix column names (`v2_status`, `shipped_date`, `shipped_via`) |
| `src/components/admin-v2/CashSaleForm.tsx` | Auto-complete in-person sales |
| `src/lib/types/admin.ts` | Add `refunded`, `cancelled` to `OrderStatus` |
| `src/hooks/admin/use-orders.ts` | Handle null `v2_status` fallback, add `deliveredAt` |
| `src/components/admin-v2/ui-primitives.tsx` | Badge colors for new statuses |
| `supabase/functions/auto-progress-orders/index.ts` | Fix `shipped_date` comparison |
| `supabase/functions/ebay-poll-orders/index.ts` | Add delivery status check logic |

