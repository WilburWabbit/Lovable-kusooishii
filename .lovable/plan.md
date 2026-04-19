

## Understanding

- Cash Sale form going forward = cash only (Stripe web orders are now drafts handled elsewhere). No code changes needed there.
- Order 1808 (`KO-0009629`, `14-14455-15045`, `2a6f226d`, in_person, £45) was created via the old Cash Sale flow when "card" was a payment_method option, but the Stripe `pi_…` was never recorded. The Stripe payout `po_1TLY2QHDItV5mfAy1M1NtzCC` (gross £45, net £44.17) has zero linked orders.
- Fix is purely a one-off data migration to link order 1808 to the Stripe payout so the deposit can be reconciled and synced to QBO as designed.

## Investigation needed before writing the migration

I need to confirm three facts before issuing the SQL — I'll do this at the start of the implementation step:

1. **Find the Stripe `pi_…` for the £45 charge on `po_1TLY2QHDItV5mfAy1M1NtzCC`** via the Stripe MCP (`stripe--fetch_stripe_resources` for the payout, then list its balance transactions / charges). Confirm there is exactly one £45 charge on that payout.
2. **Confirm Stripe fee = £0.83** matches the payout's `total_fees` so the `payout_orders` row math is clean (gross £45, fee £0.83, net £44.17).
3. **Confirm no `payout_orders` row already exists** for this payout/order pair (avoid duplicate insert).

## One-off data migration (insert tool, not schema)

Three statements, all idempotent / guarded:

```sql
-- 1. Link order 1808 to the Stripe charge so future sync flows can match by payment_reference
UPDATE sales_order
SET payment_reference = '<pi_… from Stripe>',
    payment_method   = COALESCE(payment_method, 'stripe'),
    updated_at       = now()
WHERE id = '2a6f226d-…'
  AND payment_reference IS NULL;

-- 2. Insert the missing payout_orders row (skip if it already exists)
INSERT INTO payout_orders (payout_id, sales_order_id, order_gross, order_fees, order_net)
SELECT '060ee447-… or actual id of po_1TLY…',  -- the local payouts.id
       '2a6f226d-…',
       45.00, 0.83, 44.17
WHERE NOT EXISTS (
  SELECT 1 FROM payout_orders
  WHERE payout_id = '<local payout id>'
    AND sales_order_id = '2a6f226d-…'
);

-- 3. Reset the payout so the operator can run "Sync to QBO" with the now-linked order
UPDATE payouts
SET qbo_sync_status = 'pending',
    qbo_sync_error  = NULL,
    order_count     = (SELECT COUNT(*) FROM payout_orders WHERE payout_id = '<local payout id>'),
    updated_at      = now()
WHERE external_payout_id = 'po_1TLY2QHDItV5mfAy1M1NtzCC';
```

(I'll resolve the `<…>` placeholders with `supabase--read_query` lookups before running anything.)

## Verification SQL after the migration

```sql
SELECT so.doc_number, so.payment_reference, so.payment_method,
       po.payout_id, po.order_gross, po.order_fees, po.order_net,
       p.external_payout_id, p.qbo_sync_status, p.order_count
FROM sales_order so
LEFT JOIN payout_orders po ON po.sales_order_id = so.id
LEFT JOIN payouts p ON p.id = po.payout_id
WHERE so.id = '2a6f226d-d17f-4546-bfe6-92ecbd763e16';
```

Expected: `payment_reference` = `pi_…`, `payout_id` set, payout `qbo_sync_status='pending'`, `order_count=1`. Operator then clicks **Sync to QBO** on the payout and the existing flow takes over.

## Explicitly NOT changed

- `CashSaleForm.tsx` — no code change (cash-only going forward, as you stated)
- `admin-data` cash-sale handler — unchanged
- `stripe-webhook`, `qbo-sync-payout`, `v2-reconcile-payout` — unchanged
- No new admin actions, no new buttons, no schema migration

## Files

- One-off SQL via the insert tool: 1× `UPDATE sales_order`, 1× `INSERT INTO payout_orders`, 1× `UPDATE payouts`

