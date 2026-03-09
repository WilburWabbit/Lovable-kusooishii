

## Why Receipts Don't Show: Auth Race Condition

### Root Cause

The Intake and Inventory pages fire their database queries immediately on mount, without waiting for the authentication session to be restored. When the page loads, the Supabase client hasn't yet restored the JWT from localStorage, so the query runs as an unauthenticated request. The RLS policies on `inbound_receipt` and `stock_unit` require `has_role(auth.uid(), 'admin')` or `'staff'`, which fails because `auth.uid()` is null.

There are 85 receipts in the database, but the frontend gets empty results because the query races ahead of auth.

### Fix

Gate both pages' queries on the authenticated user from `useAuth()`:

**IntakePage.tsx**
- Import `useAuth`
- Add `enabled: !!user` to the `inbound-receipts` query so it only runs once auth is ready

**InventoryPage.tsx**
- Import `useAuth`
- Add `enabled: !!user` to the `stock-units` query

### Changes
- `src/pages/admin/IntakePage.tsx` — add `useAuth` import, gate query with `enabled: !!user`
- `src/pages/admin/InventoryPage.tsx` — same pattern

No database or RLS changes needed. The policies are correct; the client just needs to wait for the session.

