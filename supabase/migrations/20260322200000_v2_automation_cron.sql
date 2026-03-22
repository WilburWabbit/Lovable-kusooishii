-- ============================================================
-- V2 Automation Cron Jobs
-- Registers pg_cron jobs for order progression and price markdowns.
-- Requires pg_cron and pg_net extensions (already installed).
-- ============================================================

-- Add markdown tracking column to SKU table
ALTER TABLE sku ADD COLUMN IF NOT EXISTS v2_markdown_applied text;

-- Auto-progress shipped orders to delivered (daily at 6am UTC)
-- Orders shipped more than 7 days ago are assumed delivered.
SELECT cron.schedule(
  'v2-auto-progress-orders',
  '0 6 * * *',
  $$
  SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'supabase_url' LIMIT 1) || '/functions/v1/auto-progress-orders',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1)
    ),
    body := '{}'::jsonb
  );
  $$
);

-- Auto-markdown stale listings (daily at 7am UTC)
-- Day 30: 10% reduction. Day 45: 20% reduction. Floor price guardrail.
SELECT cron.schedule(
  'v2-auto-markdown-prices',
  '0 7 * * *',
  $$
  SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'supabase_url' LIMIT 1) || '/functions/v1/auto-markdown-prices',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1)
    ),
    body := '{}'::jsonb
  );
  $$
);
