
# Payouts deep-dive and fix plan

## What the code does today
1. eBay payouts are created by `ebay-import-payouts`, which writes `payouts`, `payout_orders`, `payout_fee`, and `payout_fee_line`, then fire-and-forgets `v2-reconcile-payout`.
2. Stripe payouts are supposed to be created by `stripe-webhook` on `payout.paid`, which inserts a `payouts` row, links orders by `payment_reference`, then fire-and-forgets `v2-reconcile-payout`.
3. `v2-reconcile-payout` links orders, updates some fee linkage, transitions only `stock_unit` rows currently in `delivered` to `payout_received`, writes `payouts.order_count/unit_count`, then fire-and-forgets `qbo-sync-payout`.
4. The payout slide-out gets:
   - order count from `payout_fee` groups,
   - unit count from `stock_unit.payout_id`.

## Root causes found
- The unit count mismatch is real: the UI counts units only from `stock_unit.payout_id`, while orders are shown from fee rows. So a payout can show orders correctly and still show `0` units.
- Reconciliation is too narrow: it only updates units with `v2_status = 'delivered'`, and `payouts.unit_count` is based only on transitioned units, not all units covered by the payout.
- QBO payout sync is brittle: `qbo-sync-payout` uses hard-coded QBO account refs (`"1"`/`"2"`), does not surface the real QuickBooks error back to the UI, and expects fee-breakdown keys that do not match all current payout writers.
- Stripe payout handling exists in code, but it is fragile: if `payout.paid` is not being delivered, or if `payment_reference` does not line up with the payout’s balance transactions, payouts will not be created/linked. There is also no Stripe payout backfill/import path like the eBay flow has.

## Target behaviour
```text
Channel event/import
  -> land raw data
  -> create/update payout record
  -> link covered orders
  -> derive linked units from those orders
  -> transition eligible units to payout_received
  -> store accurate order_count + unit_count
  -> push deposit/fees to accounting backend
  -> save any sync error for retry/debug
```

## Implementation plan

### 1. Fix payout unit counting and reconciliation
- Update `src/hooks/admin/use-payouts.ts` so payout detail unit counts are derived from linked orders/units, not only `stock_unit.payout_id`.
- Update `supabase/functions/v2-reconcile-payout/index.ts` to:
  - compute total linked units from the payout’s linked orders,
  - update `payouts.unit_count` from that total,
  - separately track `unitsTransitioned`,
  - link/populate `payout_id` consistently on matched units,
  - avoid silent zero-unit reconciliations when orders are linked but units are not in the exact expected status.

### 2. Make the payout slide-out reflect the real payout state
- Update `src/components/admin-v2/PayoutView.tsx` to show linked unit counts from the same source as the linked orders.
- Improve reconcile success messaging so it reflects the actual function response (`orders linked`, `units linked`, `units transitioned`) instead of assuming old field names.

### 3. Fix QBO payout sync properly
- Update `supabase/functions/qbo-sync-payout/index.ts` to:
  - replace hard-coded account refs with real configured account mappings,
  - normalise fee-breakdown keys across eBay import, Stripe webhook, and manual/CSV payout paths,
  - persist the real sync error on the payout record,
  - return a failing response when deposit/expense creation fails so the UI shows the actual reason,
  - keep sync idempotent if retried.
- Update the payout UI so QBO failures are shown as real errors, not just “triggered”.

### 4. Fix Stripe payout ingestion
- Inspect runtime data/logs in default mode to determine whether the Stripe issue is:
  - missing `payout.paid` webhook delivery,
  - failed webhook processing,
  - or failed order matching via `payment_reference`.
- Then update `supabase/functions/stripe-webhook/index.ts` so payout events are landed and processed reliably, payout rows are still created when matching is partial, and reconciliation runs only after the payout record is safely written.
- If webhook delivery is the actual gap, add a Stripe payout backfill/import path so missed payouts can be recovered.

### 5. Backfill affected data
- Re-run reconciliation for existing payouts that currently show orders but zero units.
- Retry failed QBO syncs once account mapping is corrected.
- Replay/backfill missing Stripe payouts so historical payouts are complete.

## Files likely to change
- `src/hooks/admin/use-payouts.ts`
- `src/components/admin-v2/PayoutView.tsx`
- `supabase/functions/v2-reconcile-payout/index.ts`
- `supabase/functions/qbo-sync-payout/index.ts`
- `supabase/functions/stripe-webhook/index.ts`
- possibly one small additive migration only if payout error/audit columns are missing in the live schema

## Validation
- Open a payout that already has linked `payout_fee` rows and confirm units are no longer `0`.
- Reconcile an eBay payout and confirm:
  - `payout_orders` are linked,
  - units move to `payout_received`,
  - `payouts.unit_count` is correct.
- Sync that payout to QBO and confirm either:
  - deposit + expense IDs are stored, or
  - a readable sync error is stored and shown.
- Trigger/import a Stripe payout and confirm the payout record is created, linked, reconciled, and visible in the UI.
