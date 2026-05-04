
## Pending work since the last applied state

### Migrations to apply (3, in order)

The applied watermark is `20260504131707`. Three files are sitting unapplied (Lovable stores them with the last digit truncated, so newer-timestamped files can already be applied while older ones remain pending — this is the case here):

1. `20260504101500_migrate_gmc_outbox_to_merchant_api_v1.sql` — resets stuck `outbound_command` rows for `google_shopping`/`gmc` whose `last_error` was masked as `[object Object]`, and reopens the matching `reconciliation_case` rows. Pure data update, idempotent.
2. `20260504115458_repair_storefront_discovery_publish_pipeline.sql` — drops/recreates `public.browse_catalog(...)` and related storefront discovery functions (single-quoted bodies, Lovable-safe).
3. `20260504130000_channel_listing_availability_override.sql` — adds `availability_override*` columns to `channel_listing` plus a CHECK constraint, an index, and updates `queue_listing_command(...)` to honor manual out-of-stock holds.

Migration `20260504131708` (cron auth helper) is already applied.

### Edge Functions to redeploy

From the most recent commit `acdc0b3f "Harden Lovable Supabase cron auth"`:

- `auto-markdown-prices`
- `auto-progress-orders`
- `ebay-retry-order`
- `process-email-queue`
- `qbo-process-pending`
- `rebrickable-sync`

The earlier commit `7c37c9f2` touched ~22 functions and was already deployed in the previous loop. I will not redeploy those again unless the new commit's edits to `_shared/auth.ts` or `_shared/qbo-helpers.ts` require it — `git diff` shows only the 6 functions above changed in this commit and `_shared/*` is unchanged since the prior deploy, so no fan-out redeploy is needed.

## Execution

1. Apply the 3 migrations in timestamp order.
2. Deploy the 6 Edge Functions in parallel.
3. Verify:
   - `supabase_migrations.schema_migrations` contains the 3 new versions.
   - All 6 functions report successful deployment.
   - `process-email-queue` config still has `verify_jwt = true` (no change).
   - Tail edge function logs for `qbo-process-pending` and `subledger-scheduled-jobs` to confirm the cron-auth `Unauthorized` errors stop (or report them clearly if Vault `cron_shared_secret` mismatch persists from the prior loop — that is a separate, already-flagged issue).
4. Report applied migrations, deployed functions, and any failures.

No canonical data, order state, or staging rows will be modified beyond what the GMC outbox reset migration explicitly does (which is its purpose).
