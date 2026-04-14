

# Schedule eBay Payout Import — Tuesday 5am GMT

## What
Set up a `pg_cron` job that calls the `ebay-import-payouts` edge function every Tuesday at 5:00 AM GMT automatically.

## Technical Details

1. **Ensure extensions** — Enable `pg_cron` and `pg_net` if not already active.

2. **Create cron job** via SQL insert (not migration, as it contains project-specific URLs/keys):
   - Schedule: `0 5 * * 2` (5:00 AM UTC every Tuesday)
   - Calls `ebay-import-payouts` with service role auth
   - No request body needed (defaults to last 30 days)

3. **SQL to execute**:
```sql
SELECT cron.schedule(
  'ebay-import-payouts-weekly',
  '0 5 * * 2',
  $$
  SELECT net.http_post(
    url := 'https://gcgrwujfyurgetvqlmbf.supabase.co/functions/v1/ebay-import-payouts',
    headers := '{"Content-Type":"application/json","Authorization":"Bearer SERVICE_ROLE_KEY"}'::jsonb,
    body := '{}'::jsonb
  ) AS request_id;
  $$
);
```

The service role key will be pulled from the vault secret `SUPABASE_SERVICE_ROLE_KEY` already configured.

