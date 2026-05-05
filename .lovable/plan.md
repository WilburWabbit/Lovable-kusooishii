
## Plan to fix the failing cron jobs

### 1. Add a safe way to sync the cron Vault service-role key

Create a migration that extends the existing admin-only helper so it can upsert:

- `service_role_key`
- existing allowed cron secrets remain supported

This migration will not hardcode the service-role key. It will only allow the backend bootstrap function to write the current runtime key into Vault securely.

### 2. Update `bootstrap-cron-vault`

Update the existing `bootstrap-cron-vault` Edge Function so it writes these values into Vault from runtime environment variables:

- `service_role_key` from `SUPABASE_SERVICE_ROLE_KEY`
- `internal_cron_secret` from `INTERNAL_CRON_SECRET`
- `subledger_scheduled_jobs_secret` from `SUBLEDGER_SCHEDULED_JOBS_SECRET` or `INTERNAL_CRON_SECRET`
- optionally confirm `supabase_url` exists

Also harden its auth check so it validates service-role JWTs properly instead of accepting any three-part JWT-shaped token.

### 3. Deploy affected Edge Functions

Redeploy the functions involved in the current cron failures:

- `bootstrap-cron-vault`
- `qbo-process-pending`
- `subledger-scheduled-jobs`
- `ebay-retry-order`

This ensures the shared service-role JWT validation code is bundled into each deployed function.

### 4. Run the bootstrap sync

Invoke `bootstrap-cron-vault` once using the internal cron secret you provided, so the database Vault `service_role_key` is overwritten with the actual current runtime service-role key.

### 5. Validate with real cron-path calls

Run targeted validation using the same path cron uses:

- call `public.invoke_subledger_scheduled_job(...)`
- manually enqueue or wait for `qbo-process-pending-safety-net`
- manually enqueue or wait for `ebay-retry-order-every-5min`

Then check:

- `net._http_response` for new `200`/successful responses
- Edge Function logs for absence of `Unauthorized`, `invalid token`, and `Forbidden`
- `cron.job_run_details` remains successful

### 6. Report results

I’ll report:

- migrations run
- migrations skipped/already applied
- Edge Functions deployed
- validation responses from `net._http_response`
- any remaining failures or follow-up required
