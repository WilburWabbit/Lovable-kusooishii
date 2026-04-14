

# Fix: Payout Detail UI Not Showing Reconciled Orders

## Root Cause

The Payout Detail "Linked Orders" section is driven by `payout_fee` records (grouped by order). However, `v2-reconcile-payout` only creates `payout_orders` rows — it never creates `payout_fee` rows. So reconciliation succeeds (toast shows correct counts), but the UI has no fee data to display.

Evidence from the database:
- Payout `4d5577f5` (Feb 22): `po_count=1`, `fee_count=0` → UI shows "No linked orders"
- Payout `d4d92d4c` (Mar 5): `po_count=1`, `fee_count=0` → same
- Payout `78f4224e` (Apr 7): `po_count=9`, `fee_count=3` → UI works (fees came from eBay payout transaction import, not reconciliation)

The payouts that display correctly are ones where `payout_fee` rows were created by `qbo-sync-payout` or eBay payout transaction processing — not by `v2-reconcile-payout`.

## Fix: Add a `payout_orders`-based fallback to the Linked Orders UI

When `payout_fee` data is empty but `payout_orders` exist, show the linked orders from `payout_orders` instead. This requires:

### 1. Add `usePayoutOrders` hook
**File:** `src/hooks/admin/use-payouts.ts`

Add a new query hook that fetches `payout_orders` joined with `sales_order` for display (order number, gross, fees, net):
```ts
export function usePayoutOrders(payoutId: string) {
  return useQuery({
    queryKey: ['v2', 'payouts', payoutId, 'orders'],
    queryFn: async () => {
      const { data } = await supabase
        .from('payout_orders')
        .select('sales_order_id, order_gross, order_fees, order_net, sales_order:sales_order!inner(order_number, origin_reference, v2_status)')
        .eq('payout_id', payoutId);
      return data ?? [];
    },
    enabled: !!payoutId,
  });
}
```

### 2. Update PayoutDetail to use fallback
**File:** `src/components/admin-v2/PayoutDetail.tsx`

- Import and call `usePayoutOrders(payoutId)`
- When `orderFeeGroups` is empty but `payoutOrders` has data, render a simpler table showing order reference, gross, fees, and net from `payout_orders`
- Keep the existing fee-group table as primary when fee data exists

### 3. Invalidate payout_orders query after reconciliation
Ensure the reconcile mutation invalidates the new `payoutOrders` query key so the UI updates immediately after clicking Reconcile.

## Scope
- `src/hooks/admin/use-payouts.ts` — add hook + query key
- `src/components/admin-v2/PayoutDetail.tsx` — add fallback table
- No backend changes, no migrations

