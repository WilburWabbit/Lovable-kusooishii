# Lovable Latest Migrations

Run these migrations in Lovable SQL in this exact order after pulling branch
`codex/commerce-subledger-cutover`.

These files are already Lovable-safe: PL/pgSQL bodies use single-quoted
function bodies rather than `$$` or `$function$`, and the latest batch contains
no JavaScript-style `//` comments.

## Commerce Subledger Batch

1. `supabase/migrations/20260430200000_process_order_return_subledger.sql`
2. `supabase/migrations/20260430203000_queue_qbo_refund_posting_intents.sql`
3. `supabase/migrations/20260430210000_enhance_reconciliation_case_rebuild.sql`
4. `supabase/migrations/20260430213000_refresh_market_price_snapshots.sql`
5. `supabase/migrations/20260430220000_listing_command_reconciliation_cases.sql`
6. `supabase/migrations/20260430223000_listing_quantity_sync_outbox.sql`
7. `supabase/migrations/20260430230000_manage_listing_outbox_commands.sql`
8. `supabase/migrations/20260430233000_record_price_override_approvals.sql`
9. `supabase/migrations/20260430234500_admin_subledger_maintenance_rpcs.sql`
10. `supabase/migrations/20260430235500_queue_qbo_payout_posting_intents.sql`
11. `supabase/migrations/20260430235600_queue_qbo_item_posting_intents.sql`
12. `supabase/migrations/20260430235700_queue_qbo_customer_posting_intents.sql`
13. `supabase/migrations/20260430235800_queue_qbo_purchase_posting_intents.sql`

## Smoke Checks

After running the batch, this query should return all functions with one row
each:

```sql
SELECT proname
FROM pg_proc
JOIN pg_namespace ON pg_namespace.oid = pg_proc.pronamespace
WHERE pg_namespace.nspname = 'public'
  AND proname IN (
    'cancel_listing_outbound_command',
    'queue_listing_command',
    'queue_qbo_refund_posting_intent_for_order',
    'queue_qbo_payout_posting_intent',
    'queue_qbo_item_posting_intent',
    'queue_qbo_customer_posting_intent',
    'queue_qbo_purchase_posting_intent',
    'rebuild_listing_command_reconciliation_cases',
    'rebuild_reconciliation_cases',
    'record_price_override_approval',
    'refresh_market_price_snapshots',
    'refresh_sku_cost_rollups',
    'release_stock_allocation_for_order_line',
    'process_order_return',
    'retry_listing_outbound_command'
  )
ORDER BY proname;
```

Expected function names:

```text
cancel_listing_outbound_command
process_order_return
queue_listing_command
queue_qbo_customer_posting_intent
queue_qbo_item_posting_intent
queue_qbo_payout_posting_intent
queue_qbo_purchase_posting_intent
queue_qbo_refund_posting_intent_for_order
rebuild_listing_command_reconciliation_cases
rebuild_reconciliation_cases
record_price_override_approval
refresh_market_price_snapshots
refresh_sku_cost_rollups
release_stock_allocation_for_order_line
retry_listing_outbound_command
```

If the smoke query only returns `cancel_listing_outbound_command` and
`process_order_return`, the latest batch has not been applied. Run the migration
files above in order. `cancel_listing_outbound_command` and
`retry_listing_outbound_command` are in the same file, so seeing only one of
them usually means a partial paste/run rather than a dependency problem.

This query should return zero rows:

```sql
SELECT id, action, entity_type, entity_id, status, last_error
FROM posting_intent
WHERE target_system = 'qbo'
  AND action IN (
    'create_payout_deposit',
    'upsert_item',
    'upsert_customer',
    'create_purchase',
    'update_purchase',
    'delete_purchase'
  )
  AND status = 'failed'
ORDER BY updated_at DESC
LIMIT 20;
```
