# Apply PR #115 — Rolling Blue Bell Operations Cleanup

## Scope of PR #115

Three files, all already synced into the working tree via the GitHub two-way sync:

1. `supabase/migrations/20260502113000_rolling_blue_bell_operations_cleanup.sql` — **new, not yet applied to the database**
2. `src/hooks/admin/use-operations.ts` — frontend (no action needed; already in tree)
3. `src/components/admin-v2/OperationsView.tsx` — frontend (no action needed; already in tree)

**No edge functions are added or modified in this PR**, so there is nothing to deploy on the functions side.

## Database verification

- `supabase_migrations.schema_migrations` contains `20260502063313` and `20260502064604` for today, but **not** `20260502113000`.
- The view `public.v_blue_bell_accrual_ledger` (created by this migration) does not exist yet.

## What the migration does

1. Backfills `sales_program_attribution` rows for every `sales_order` flagged with the legacy `blue_bell_club = true`, mapping them to the `blue_bell` program with source `legacy_backfill`.
2. Backfills `sales_program_accrual` rows (type `commission`) for those orders, deriving `basis_amount`, `discount_amount`, and `commission_amount` from legacy `club_commission_amount` / `club_discount_amount` (falling back to gross − shipping × default rates). Open accruals get status `open`; zero-commission rows are skipped. Existing rows are only refreshed when still open and unsettled.
3. Resolves any open/in-progress `reconciliation_case` rows of type `unpaid_program_accrual` with close code `moved_to_blue_bell_accrual_ledger`, recording the migration in `evidence`.
4. Creates / replaces the `public.v_blue_bell_accrual_ledger` view that joins accruals to orders, settlements, and the entity-reference helper view, and exposes `commission_outstanding`.
5. (Remaining ~400 lines, not fully shown but already in the file) finishes the view definitions and supporting glue used by the operations page.

## Steps to execute

1. Run the migration `supabase/migrations/20260502113000_rolling_blue_bell_operations_cleanup.sql` against the Lovable Cloud database via the migration tool.
2. After it succeeds, re-check:
   - `supabase_migrations.schema_migrations` contains `20260502113000`.
   - `public.v_blue_bell_accrual_ledger` exists and returns rows.
   - All `reconciliation_case` rows with `case_type = 'unpaid_program_accrual'` are now `resolved` (so the `/admin/operations` Reconciliation Inbox no longer surfaces them — matching the new frontend filter `.neq('case_type', 'unpaid_program_accrual')`).
3. No edge function deploys required.

## Risks / notes

- The migration is idempotent: attribution insert uses `ON CONFLICT DO NOTHING`; accrual upsert only overwrites rows that are still open, unsettled, and have zero commission; reconciliation update is scoped to `status IN ('open', 'in_progress')`.
- Uses single-quoted strings throughout (no `$$` dollar-quoting), per the project's Lovable SQL-runner constraint.
- Frontend already expects the new view and the resolved cases, so applying the migration brings backend in line with already-shipped UI.
