## Goal

Unblock the failing `qbo-wholesale-refresh` edge function by creating the `qbo_refresh_run` and `qbo_refresh_drift` tables (plus their RLS, indexes, trigger, RPCs, and view) that section 5 of `20260501010000_rolling_operations_reference_grading_qbo_refresh.sql` defines but which were never applied to the database.

## Why a new, smaller migration

The original file `20260501010000_rolling_operations_reference_grading_qbo_refresh.sql` is 2,043 lines and bundles four other large concerns (G5 saleability, mandatory product gates, reference normalization, reconciliation views). Re-running it now would conflict with later migrations that already touched the same objects. We therefore extract only the QBO refresh section (lines 1551–2030) into a new, idempotent migration.

## Migration to create

File: `supabase/migrations/20260501120000_qbo_wholesale_refresh_foundation.sql`

Creates:

- **`public.qbo_refresh_run`** — tracks each wholesale refresh execution (mode, status, requested scope, result summary, timing).
- **`public.qbo_refresh_drift`** — per-row drift findings (entity type, severity, status, current vs QBO values, recommended action).
- **RLS** — enabled on both tables. Single staff/admin policy on each (`subledger_staff_read_policy`) for FOR ALL.
- **Trigger** — `set_qbo_refresh_run_updated_at` keeps `updated_at` current.
- **Indexes** on `qbo_refresh_drift` for `(run, status, severity)`, `(qbo_entity_type, qbo_entity_id)`, and `(local_entity_type, local_entity_id)`.
- **Functions**:
  - `rebuild_qbo_refresh_drift(uuid)` — populates drift rows by comparing app data against `landing_raw_qbo_*` (items, sales receipts, purchases, customers) and opens reconciliation cases.
  - `approve_qbo_refresh_drift(uuid, uuid)` — staff approval of a drift row.
  - `apply_approved_qbo_refresh_drift(uuid, uuid)` — applies approved corrections to `sku.qbo_item_id`, `sales_order.qbo_sales_receipt_id`/`doc_number`, `purchase_batches.qbo_purchase_id`, `customer.qbo_customer_id`, with audit events.
- **View** `v_qbo_refresh_drift` — drift rows joined with parent run mode/status/timing.
- **Grants** — SELECT to `authenticated` on tables/view; EXECUTE to `authenticated, service_role` on the three functions.

All `CREATE TABLE`/`CREATE INDEX`/`DROP POLICY IF EXISTS`/`CREATE OR REPLACE` make the migration safely re-runnable. PL/pgSQL bodies use single-quoted strings with doubled internal quotes (Lovable SQL runner safe).

## After applying

No edge function or frontend code change required — `qbo-wholesale-refresh` already references these objects. A simple test invocation should succeed once the migration runs.

## Out of scope

The other four sections of `20260501010000_*` (G5 saleability, posting-intent gates, reference normalization, reconciliation views) are not included here. Most of the RPCs they define (e.g., `queue_qbo_item_posting_intent`) are already present from later catch-up migrations. If a separate audit shows specific objects from those sections are still missing, we can extract them similarly in follow-up migrations.
