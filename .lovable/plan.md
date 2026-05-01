## Goal

Add a preflight **QBO Health Check** panel at the top of `/admin/data-sync` (the Admin V2 `DataSyncPage`) that verifies the required database objects exist (e.g. `qbo_refresh_run`, `qbo_refresh_drift`, plus other QBO-critical tables) and clearly reports any missing migrations, so staff can detect schema gaps before invoking QBO edge functions like `qbo-wholesale-refresh`.

## What gets built

### 1. Edge function: `qbo-health-check`

A new read-only Deno edge function at `supabase/functions/qbo-health-check/index.ts`.

- Uses the service-role client to query `information_schema.tables` and `pg_proc` for a curated allowlist of expected QBO objects.
- Returns a structured JSON report: `{ ok: boolean, checks: [{ name, kind: 'table'|'function'|'view', present, severity: 'critical'|'warn', migration_hint }], missing_count, generated_at }`.
- Also reports recent applied migration versions from `supabase_migrations.schema_migrations` (most recent 10) so staff can see whether a known migration ID is present.
- No mutations, no third-party calls. CORS handled per project conventions; uses `verify_jwt = false` default plus an in-code admin role check via `has_role(auth.uid(), 'admin')` against the caller's JWT, returning 401/403 if not authorised.

### 2. Allowlist of required QBO objects (initial set)

Tables: `qbo_refresh_run`, `qbo_refresh_drift`, `qbo_sync_state`, `qbo_posting_intents`, `landing_raw_qbo_*` family (items, customers, vendors, sales, purchases), `qbo_account_mappings`.
Functions: `rebuild_qbo_refresh_drift`, `approve_qbo_refresh_drift`, `apply_approved_qbo_refresh_drift`, `has_role`.
View: `v_qbo_refresh_drift`.
Each entry carries the migration filename that introduces it as `migration_hint` so the UI can tell staff exactly which migration to apply.

### 3. UI: `QboHealthCheckCard` component

New component at `src/components/admin-v2/QboHealthCheckCard.tsx`, rendered as the first item in `DataSyncPage` (above `StagingErrorsPanel`).

- On mount and via a "Re-run check" button, calls `qbo-health-check` through `invokeWithAuth`.
- Shows an overall status badge: green "Healthy", amber "Warnings", red "Missing migrations".
- Lists each missing object with its kind, severity, and the migration filename to apply.
- When critical objects are missing, renders a non-blocking warning banner advising staff not to run QBO sync/refresh actions until migrations are applied. Does not disable the other cards (so staff can still triage), but the QBO action cards read a shared `useQboHealth()` hook (new, in `src/hooks/admin/useQboHealth.ts`) and visibly disable destructive actions (refresh, process-pending) when `missing_count > 0` for critical entries, with a tooltip explaining why.
- Shows the latest 10 applied migration versions in a collapsible section for fast diagnosis.

### 4. Wiring

- `DataSyncPage.tsx` imports and renders `<QboHealthCheckCard />` first.
- `QboSettingsCard.tsx` consumes `useQboHealth()` and disables the QBO Wholesale Refresh, Process Pending, and Replay buttons when critical checks fail, with an inline message linking to the health card.

## Technical notes

- Health-check function uses a single SQL round-trip: one query against `information_schema.tables` filtered by the allowlist names, one against `pg_proc` joined to `pg_namespace = 'public'`, one against `information_schema.views`, and one against `supabase_migrations.schema_migrations`. Results merged in-memory.
- Allowlist lives in a shared constant file so both the edge function and the UI can render the same list (edge owns the source of truth; UI just renders the response).
- No new tables or migrations are required — this is a pure inspection feature.
- Follows project rules: read-only receiver pattern, no inline business logic, parameterised queries only, admin role enforced server-side.

## Out of scope

- Auto-applying missing migrations (staff still apply via existing migration flow).
- Health checks for non-QBO integrations (eBay, Stripe, BrickEconomy) — can be added later using the same pattern.
